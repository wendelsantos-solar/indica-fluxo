import "server-only"

import { and, eq, inArray, like, ne, or } from "drizzle-orm"

import { type Transaction, withUser } from "@/server/db"
import {
  commissions,
  payoutBatches,
  payoutItemCommissions,
  payoutItems,
} from "@/server/db/schema"
import { ConflictError, NotFoundError, ValidationError } from "@/server/policies/errors"
import { requireMembership } from "@/server/policies/workspace"
import {
  commissionInEnvironment,
  payableCommissionFilter,
  promoteEligibleCommissions,
} from "@/server/repositories/commissions"
import { findPayoutBatch, listBatchItems } from "@/server/repositories/payouts"

import { recordAudit } from "./audit"
import type { ProgramEnvironment } from "./programs"

/**
 * Payouts move no money. A batch records what the founder says they paid, and
 * snapshots the amounts so later ledger activity cannot rewrite history.
 * See ARCHITECTURE.md §3.4.
 */

export interface CreateBatchInput {
  /**
   * Batches are per environment: a test batch pays only test commissions and
   * moves no money; a live batch only live ones.
   */
  environment: ProgramEnvironment
  currency: string
  participationIds: string[]
  periodStart: Date
  periodEnd: Date
  notes?: string | null
}

export async function createPayoutBatch(
  userId: string,
  workspaceId: string,
  input: CreateBatchInput,
): Promise<{ id: string; reference: string; totalAmountMinor: number }> {
  const participationIds = [...new Set(input.participationIds)]
  if (participationIds.length === 0) {
    throw new ValidationError("Select at least one affiliate to pay.", {}, "selectAffiliate")
  }
  const currency = input.currency.toUpperCase()

  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

    // Write down every `pending → available` the clock has already decided,
    // so the ledger is correct at the moment money is committed. Reads apply
    // the same rule without writing (`payableCommissionFilter`).
    await promoteEligibleCommissions(tx, workspaceId)

    // Lock the commissions being paid so a concurrent batch cannot claim them.
    // A batch is single-currency by construction: only this currency is read.
    const claimable = await tx
      .select({
        id: commissions.id,
        programAffiliateId: commissions.programAffiliateId,
        commissionAmountMinor: commissions.commissionAmountMinor,
      })
      .from(commissions)
      .where(
        and(
          eq(commissions.workspaceId, workspaceId),
          eq(commissions.currency, currency),
          inArray(commissions.programAffiliateId, participationIds),
          commissionInEnvironment(input.environment),
          payableCommissionFilter(),
        ),
      )
      .for("update")

    if (claimable.length === 0) {
      throw new ConflictError("Those affiliates have no payable commissions right now.", "nothingPayable")
    }

    // The lock waits for a concurrent batch to commit, but the NOT EXISTS above
    // was evaluated against the snapshot taken before it. Re-read the claims
    // in a fresh statement so a commission can never land in two live batches.
    const [alreadyClaimed] = await tx
      .select({ id: payoutItemCommissions.commissionId })
      .from(payoutItemCommissions)
      .innerJoin(payoutItems, eq(payoutItems.id, payoutItemCommissions.payoutItemId))
      .where(
        and(
          inArray(
            payoutItemCommissions.commissionId,
            claimable.map((row) => row.id),
          ),
          ne(payoutItems.status, "cancelled"),
        ),
      )
      .limit(1)

    if (alreadyClaimed) {
      throw new ConflictError("Some of those commissions were batched meanwhile.", "payableChanged")
    }

    const byParticipation = new Map<string, { total: number; ids: string[] }>()
    for (const row of claimable) {
      const bucket = byParticipation.get(row.programAffiliateId) ?? { total: 0, ids: [] }
      bucket.total += row.commissionAmountMinor
      bucket.ids.push(row.id)
      byParticipation.set(row.programAffiliateId, bucket)
    }

    // Everyone the founder ticked must be in the batch with something to be
    // paid; a silently shorter batch is worse than asking them to look again.
    const missing = participationIds.filter((id) => (byParticipation.get(id)?.total ?? 0) <= 0)
    if (missing.length > 0) {
      throw new ConflictError(
        `${missing.length} selected affiliate(s) have nothing payable in ${currency}.`,
        "payableChanged",
      )
    }

    const total = [...byParticipation.values()].reduce((sum, b) => sum + b.total, 0)
    if (total <= 0) throw new ConflictError("The selected commissions net to zero or less.", "netsToZero")

    const reference = await uniqueReference(tx, workspaceId, input.environment, buildReference(input.periodEnd))

    const [batch] = await tx
      .insert(payoutBatches)
      .values({
        workspaceId,
        reference,
        environment: input.environment,
        currency,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        status: "approved",
        totalAmountMinor: total,
        notes: input.notes?.trim() || null,
        createdBy: userId,
      })
      .returning({ id: payoutBatches.id })

    for (const [participationId, bucket] of byParticipation) {
      const [item] = await tx
        .insert(payoutItems)
        .values({
          payoutBatchId: batch!.id,
          programAffiliateId: participationId,
          amountMinor: bucket.total,
          currency,
          status: "pending",
        })
        .returning({ id: payoutItems.id })

      await tx.insert(payoutItemCommissions).values(
        bucket.ids.map((commissionId) => ({
          payoutItemId: item!.id,
          commissionId,
        })),
      )

      await tx
        .update(commissions)
        .set({ status: "approved", approvedAt: new Date() })
        .where(inArray(commissions.id, bucket.ids))
    }

    await recordAudit(tx, {
      workspaceId,
      actorUserId: userId,
      entityType: "payout_batch",
      entityId: batch!.id,
      action: "payout.created",
      metadata: {
        reference,
        environment: input.environment,
        affiliates: byParticipation.size,
        totalAmountMinor: total,
        currency,
      },
    })

    return { id: batch!.id, reference, totalAmountMinor: total }
  })
}

function buildReference(periodEnd: Date): string {
  const month = periodEnd.toLocaleString("en-US", { month: "long", timeZone: "UTC" })
  return `${month} ${periodEnd.getUTCFullYear()}`
}

/**
 * `payout_batches_workspace_reference_key` is unique per workspace and
 * environment, and a founder paying two currencies (or two rounds) in one month
 * needs more than one batch: the second becomes "September 2026 #2".
 */
async function uniqueReference(
  tx: Transaction,
  workspaceId: string,
  environment: ProgramEnvironment,
  base: string,
): Promise<string> {
  const taken = await tx
    .select({ reference: payoutBatches.reference })
    .from(payoutBatches)
    .where(
      and(
        eq(payoutBatches.workspaceId, workspaceId),
        eq(payoutBatches.environment, environment),
        or(eq(payoutBatches.reference, base), like(payoutBatches.reference, `${base} #%`)),
      ),
    )

  const references = new Set(taken.map((row) => row.reference))
  if (!references.has(base)) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base} #${n}`
    if (!references.has(candidate)) return candidate
  }
}

/**
 * Locks an approved batch of this workspace and the commissions it holds, in
 * that order, for the rest of the transaction. The batch lock serialises
 * mark-paid against cancel; the commission locks keep a refund arriving through
 * the webhook from flipping a commission to `reversed` between the read below
 * and the write that settles it.
 */
async function lockApprovedBatch(tx: Transaction, workspaceId: string, batchId: string) {
  const [batch] = await tx
    .select({ id: payoutBatches.id, status: payoutBatches.status, totalAmountMinor: payoutBatches.totalAmountMinor })
    .from(payoutBatches)
    .where(and(eq(payoutBatches.id, batchId), eq(payoutBatches.workspaceId, workspaceId)))
    .limit(1)
    .for("update")

  if (!batch) throw new NotFoundError("Payout batch not found.", "batchNotFound")
  if (batch.status === "paid") throw new ConflictError("That batch is already marked as paid.", "batchAlreadyPaid")
  if (batch.status === "cancelled") throw new ConflictError("That batch was cancelled.", "batchCancelled")

  const held = await tx
    .select({
      commissionId: commissions.id,
      payoutItemId: payoutItemCommissions.payoutItemId,
      status: commissions.status,
      amountMinor: commissions.commissionAmountMinor,
    })
    .from(payoutItemCommissions)
    .innerJoin(payoutItems, eq(payoutItems.id, payoutItemCommissions.payoutItemId))
    .innerJoin(commissions, eq(commissions.id, payoutItemCommissions.commissionId))
    .where(eq(payoutItems.payoutBatchId, batchId))
    .for("update", { of: commissions })

  return { batch, held }
}

/**
 * Records that the founder paid the batch.
 *
 * A commission refunded after the batch was created is `reversed` by the
 * billing webhook. It is never paid: it stays `reversed`, and each item's
 * amount is recomputed from the commissions that are still owed, so the paid
 * record is what was actually owed at the moment of payment. An item left with
 * nothing to pay is cancelled rather than paid. The difference (commissions and
 * amount taken out) goes into the audit entry. Once paid, the snapshot is
 * final: later ledger activity never rewrites it.
 */
export async function markBatchPaid(
  userId: string,
  workspaceId: string,
  batchId: string,
  externalReference?: string | null,
): Promise<void> {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

    const { batch, held } = await lockApprovedBatch(tx, workspaceId, batchId)

    const owedByItem = new Map<string, { amount: number; ids: string[] }>()
    let reversedCount = 0
    let reversedAmount = 0
    for (const row of held) {
      const bucket = owedByItem.get(row.payoutItemId) ?? { amount: 0, ids: [] }
      if (row.status === "reversed") {
        reversedCount += 1
        reversedAmount += row.amountMinor
      } else {
        bucket.amount += row.amountMinor
        bucket.ids.push(row.commissionId)
      }
      owedByItem.set(row.payoutItemId, bucket)
    }

    const payable = [...owedByItem.entries()].filter(([, bucket]) => bucket.amount > 0)
    const nothingLeft = [...owedByItem.entries()].filter(([, bucket]) => bucket.amount <= 0)
    if (payable.length === 0) {
      throw new ConflictError("Every commission in this batch was reversed; cancel it instead.", "batchFullyReversed")
    }

    const now = new Date()
    const reference = externalReference?.trim() || null

    for (const [itemId, bucket] of payable) {
      await tx
        .update(payoutItems)
        .set({ status: "paid", paidAt: now, externalReference: reference, amountMinor: bucket.amount })
        .where(eq(payoutItems.id, itemId))
    }
    if (nothingLeft.length > 0) {
      await tx
        .update(payoutItems)
        .set({ status: "cancelled", amountMinor: 0 })
        .where(inArray(payoutItems.id, nothingLeft.map(([itemId]) => itemId)))
    }

    // Paid: the non-reversed commissions only, and never a row whose status
    // changed under the lock.
    const paidIds = payable.flatMap(([, bucket]) => bucket.ids)
    await tx
      .update(commissions)
      .set({ status: "paid", paidAt: now })
      .where(and(inArray(commissions.id, paidIds), ne(commissions.status, "reversed")))

    const total = payable.reduce((sum, [, bucket]) => sum + bucket.amount, 0)
    await tx
      .update(payoutBatches)
      .set({ status: "paid", paidAt: now, totalAmountMinor: total })
      .where(eq(payoutBatches.id, batchId))

    await recordAudit(tx, {
      workspaceId,
      actorUserId: userId,
      entityType: "payout_batch",
      entityId: batchId,
      action: "payout.marked_paid",
      metadata: {
        items: payable.length,
        cancelledItems: nothingLeft.length,
        totalAmountMinor: total,
        ...(reversedCount > 0
          ? {
              reversedCommissions: reversedCount,
              reversedAmountMinor: reversedAmount,
              originalTotalAmountMinor: batch.totalAmountMinor,
            }
          : {}),
      },
    })
  })
}

/**
 * Releases an approved batch. Its commissions go back to `available` so a
 * later batch can pay them — except any reversed meanwhile, which stay
 * `reversed`: a refunded commission must never become payable again.
 */
export async function cancelPayoutBatch(
  userId: string,
  workspaceId: string,
  batchId: string,
): Promise<void> {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

    let locked
    try {
      locked = await lockApprovedBatch(tx, workspaceId, batchId)
    } catch (error) {
      if (error instanceof ConflictError && error.messageKey === "batchAlreadyPaid") {
        throw new ConflictError("A paid batch cannot be cancelled; record an adjustment instead.", "paidBatchNotCancellable")
      }
      // Cancelling twice would release commissions a later batch has claimed since.
      throw error
    }

    const ids = locked.held.map((row) => row.commissionId)
    if (ids.length > 0) {
      // `approved` is what the batch made them; `reversed` (or anything else)
      // was decided by the ledger since and is left alone.
      await tx
        .update(commissions)
        .set({ status: "available", approvedAt: null })
        .where(and(inArray(commissions.id, ids), eq(commissions.status, "approved")))
    }

    await tx
      .update(payoutItems)
      .set({ status: "cancelled" })
      .where(eq(payoutItems.payoutBatchId, batchId))

    await tx
      .update(payoutBatches)
      .set({ status: "cancelled" })
      .where(eq(payoutBatches.id, batchId))

    await recordAudit(tx, {
      workspaceId,
      actorUserId: userId,
      entityType: "payout_batch",
      entityId: batchId,
      action: "payout.cancelled",
      metadata: {
        releasedCommissions: locked.held.filter((row) => row.status === "approved").length,
        reversedCommissions: locked.held.filter((row) => row.status === "reversed").length,
      },
    })
  })
}

/** More affiliates than any single transfer run; a hard cap all the same. */
export const EXPORT_ITEM_LIMIT = 10_000

/**
 * What a payout export needs: the batch and every affiliate in it, with e-mail.
 * Owners and admins only — the export is the list the money is sent from, and
 * the same role is required to create, cancel or mark a batch paid. Members
 * still read the batch page under RLS.
 */
export async function getPayoutBatchExport(userId: string, workspaceId: string, batchId: string) {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

    const batch = await findPayoutBatch(tx, workspaceId, batchId)
    if (!batch) throw new NotFoundError("Payout batch not found.", "batchNotFound")

    const items = await listBatchItems(tx, batch.id, EXPORT_ITEM_LIMIT)
    return { batch, items }
  })
}
