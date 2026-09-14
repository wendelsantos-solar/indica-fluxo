import "server-only"

import { and, desc, eq, inArray, sql } from "drizzle-orm"

import { withUser } from "@/server/db"
import { qualified } from "@/server/db/qualify"
import {
  affiliates,
  commissions,
  payoutBatches,
  payoutItemCommissions,
  payoutItems,
  programAffiliates,
} from "@/server/db/schema"
import { ConflictError, NotFoundError, ValidationError } from "@/server/policies/errors"
import { requireMembership } from "@/server/policies/workspace"

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
  if (input.participationIds.length === 0) {
    throw new ValidationError("Select at least one affiliate to pay.", {}, "selectAffiliate")
  }

  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

    // Lock the commissions being paid so a concurrent batch cannot claim them.
    const claimable = await tx
      .select({
        id: commissions.id,
        programAffiliateId: commissions.programAffiliateId,
        currency: commissions.currency,
        commissionAmountMinor: commissions.commissionAmountMinor,
      })
      .from(commissions)
      .where(
        and(
          eq(commissions.workspaceId, workspaceId),
          eq(commissions.currency, input.currency.toUpperCase()),
          inArray(commissions.programAffiliateId, input.participationIds),
          inArray(commissions.status, ["available", "approved"]),
        ),
      )
      .for("update")

    if (claimable.length === 0) {
      throw new ConflictError("Those affiliates have no payable commissions right now.", "nothingPayable")
    }

    const byParticipation = new Map<string, { total: number; ids: string[] }>()
    for (const row of claimable) {
      const bucket = byParticipation.get(row.programAffiliateId) ?? { total: 0, ids: [] }
      bucket.total += row.commissionAmountMinor
      bucket.ids.push(row.id)
      byParticipation.set(row.programAffiliateId, bucket)
    }

    const total = [...byParticipation.values()].reduce((sum, b) => sum + b.total, 0)
    if (total <= 0) throw new ConflictError("The selected commissions net to zero or less.", "netsToZero")

    const reference = buildReference(input.periodEnd)

    const [batch] = await tx
      .insert(payoutBatches)
      .values({
        workspaceId,
        reference,
        currency: input.currency.toUpperCase(),
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        status: "approved",
        totalAmountMinor: total,
        notes: input.notes?.trim() || null,
        createdBy: userId,
      })
      .returning({ id: payoutBatches.id })

    for (const [participationId, bucket] of byParticipation) {
      if (bucket.total <= 0) continue

      const [item] = await tx
        .insert(payoutItems)
        .values({
          payoutBatchId: batch!.id,
          programAffiliateId: participationId,
          amountMinor: bucket.total,
          currency: input.currency.toUpperCase(),
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
        currency: input.currency,
      },
    })

    return { id: batch!.id, reference, totalAmountMinor: total }
  })
}

function buildReference(periodEnd: Date): string {
  const month = periodEnd.toLocaleString("en-US", { month: "long", timeZone: "UTC" })
  return `${month} ${periodEnd.getUTCFullYear()}`
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

export async function listPayoutBatches(tx: Parameters<Parameters<typeof withUser>[1]>[0], workspaceId: string) {
  return tx
    .select({
      id: payoutBatches.id,
      reference: payoutBatches.reference,
      currency: payoutBatches.currency,
      status: payoutBatches.status,
      totalAmountMinor: payoutBatches.totalAmountMinor,
      periodStart: payoutBatches.periodStart,
      periodEnd: payoutBatches.periodEnd,
      paidAt: payoutBatches.paidAt,
      createdAt: payoutBatches.createdAt,
      affiliateCount: sql<number>`(
        select count(*)::int from ${payoutItems}
         where ${payoutItems.payoutBatchId} = ${qualified(payoutBatches.id)})`,
    })
    .from(payoutBatches)
    .where(eq(payoutBatches.workspaceId, workspaceId))
    .orderBy(desc(payoutBatches.createdAt))
}

export async function listBatchItems(
  tx: Parameters<Parameters<typeof withUser>[1]>[0],
  batchId: string,
) {
  return tx
    .select({
      id: payoutItems.id,
      amountMinor: payoutItems.amountMinor,
      currency: payoutItems.currency,
      status: payoutItems.status,
      externalReference: payoutItems.externalReference,
      paidAt: payoutItems.paidAt,
      affiliateName: affiliates.name,
      affiliateEmail: affiliates.email,
      code: programAffiliates.code,
    })
    .from(payoutItems)
    .innerJoin(programAffiliates, eq(programAffiliates.id, payoutItems.programAffiliateId))
    .innerJoin(affiliates, eq(affiliates.id, programAffiliates.affiliateId))
    .where(eq(payoutItems.payoutBatchId, batchId))
    .orderBy(desc(payoutItems.amountMinor))
}
