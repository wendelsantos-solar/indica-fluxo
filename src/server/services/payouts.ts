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
  payableCommissionFilter,
  promoteEligibleCommissions,
} from "@/server/repositories/commissions"

import { recordAudit } from "./audit"

/**
 * Payouts move no money. A batch records what the founder says they paid, and
 * snapshots the amounts so later ledger activity cannot rewrite history.
 * See ARCHITECTURE.md §3.4.
 */

export interface CreateBatchInput {
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

    const reference = await uniqueReference(tx, workspaceId, buildReference(input.periodEnd))

    const [batch] = await tx
      .insert(payoutBatches)
      .values({
        workspaceId,
        reference,
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
 * `payout_batches_workspace_reference_key` is unique, and a founder paying two
 * currencies (or two rounds) in one month needs more than one batch: the second
 * becomes "September 2026 #2".
 */
async function uniqueReference(tx: Transaction, workspaceId: string, base: string): Promise<string> {
  const taken = await tx
    .select({ reference: payoutBatches.reference })
    .from(payoutBatches)
    .where(
      and(
        eq(payoutBatches.workspaceId, workspaceId),
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

export async function markBatchPaid(
  userId: string,
  workspaceId: string,
  batchId: string,
  externalReference?: string | null,
): Promise<void> {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

    const [batch] = await tx
      .select({ id: payoutBatches.id, status: payoutBatches.status })
      .from(payoutBatches)
      .where(and(eq(payoutBatches.id, batchId), eq(payoutBatches.workspaceId, workspaceId)))
      .limit(1)

    if (!batch) throw new NotFoundError("Payout batch not found.", "batchNotFound")
    if (batch.status === "paid") throw new ConflictError("That batch is already marked as paid.", "batchAlreadyPaid")
    if (batch.status === "cancelled") throw new ConflictError("That batch was cancelled.", "batchCancelled")

    const now = new Date()

    await tx
      .update(payoutBatches)
      .set({ status: "paid", paidAt: now })
      .where(eq(payoutBatches.id, batchId))

    const items = await tx
      .update(payoutItems)
      .set({
        status: "paid",
        paidAt: now,
        externalReference: externalReference?.trim() || null,
      })
      .where(eq(payoutItems.payoutBatchId, batchId))
      .returning({ id: payoutItems.id })

    await tx
      .update(commissions)
      .set({ status: "paid", paidAt: now })
      .where(
        inArray(
          commissions.id,
          tx
            .select({ id: payoutItemCommissions.commissionId })
            .from(payoutItemCommissions)
            .where(
              inArray(
                payoutItemCommissions.payoutItemId,
                items.map((i) => i.id),
              ),
            ),
        ),
      )

    await recordAudit(tx, {
      workspaceId,
      actorUserId: userId,
      entityType: "payout_batch",
      entityId: batchId,
      action: "payout.marked_paid",
      metadata: { items: items.length },
    })
  })
}

export async function cancelPayoutBatch(
  userId: string,
  workspaceId: string,
  batchId: string,
): Promise<void> {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

    const [batch] = await tx
      .select({ status: payoutBatches.status })
      .from(payoutBatches)
      .where(and(eq(payoutBatches.id, batchId), eq(payoutBatches.workspaceId, workspaceId)))
      .limit(1)

    if (!batch) throw new NotFoundError("Payout batch not found.", "batchNotFound")
    if (batch.status === "paid") {
      throw new ConflictError("A paid batch cannot be cancelled; record an adjustment instead.", "paidBatchNotCancellable")
    }
    // Cancelling twice would release commissions a later batch has claimed since.
    if (batch.status === "cancelled") throw new ConflictError("That batch was cancelled.", "batchCancelled")

    const items = await tx
      .select({ id: payoutItems.id })
      .from(payoutItems)
      .where(eq(payoutItems.payoutBatchId, batchId))

    // Release the commissions back to `available` so they can be paid later.
    if (items.length > 0) {
      await tx
        .update(commissions)
        .set({ status: "available", approvedAt: null })
        .where(
          inArray(
            commissions.id,
            tx
              .select({ id: payoutItemCommissions.commissionId })
              .from(payoutItemCommissions)
              .where(
                inArray(
                  payoutItemCommissions.payoutItemId,
                  items.map((i) => i.id),
                ),
              ),
          ),
        )
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
    })
  })
}
