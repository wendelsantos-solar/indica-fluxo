import "server-only"

import { and, desc, eq, sql } from "drizzle-orm"

import { type DbClient } from "@/server/db"
import { qualified } from "@/server/db/qualify"
import {
  affiliates,
  payoutBatches,
  payoutItemCommissions,
  payoutItems,
  programAffiliates,
} from "@/server/db/schema"

/**
 * Read models for payout batches. Writes stay in `services/payouts.ts`, inside
 * the transaction that authorises them.
 */

/** The workspace's batches, newest first; one environment when `environment` is given. */
export async function listPayoutBatches(tx: DbClient, workspaceId: string, environment?: "test" | "live") {
  return tx
    .select({
      id: payoutBatches.id,
      reference: payoutBatches.reference,
      environment: payoutBatches.environment,
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
    .where(
      and(
        eq(payoutBatches.workspaceId, workspaceId),
        environment ? eq(payoutBatches.environment, environment) : undefined,
      ),
    )
    .orderBy(desc(payoutBatches.createdAt))
    .limit(200)
}

/**
 * One batch of this workspace, or null. RLS already hides other workspaces'
 * batches; the explicit predicate keeps a member of two workspaces from
 * opening one through the other's URL.
 */
export async function findPayoutBatch(tx: DbClient, workspaceId: string, batchId: string) {
  const [row] = await tx
    .select({
      id: payoutBatches.id,
      reference: payoutBatches.reference,
      environment: payoutBatches.environment,
      currency: payoutBatches.currency,
      status: payoutBatches.status,
      totalAmountMinor: payoutBatches.totalAmountMinor,
      periodStart: payoutBatches.periodStart,
      periodEnd: payoutBatches.periodEnd,
      notes: payoutBatches.notes,
      paidAt: payoutBatches.paidAt,
      createdAt: payoutBatches.createdAt,
      affiliateCount: sql<number>`(
        select count(*)::int from ${payoutItems}
         where ${payoutItems.payoutBatchId} = ${qualified(payoutBatches.id)})`,
      commissionCount: sql<number>`(
        select count(*)::int from ${payoutItemCommissions}
          join ${payoutItems} on ${payoutItems.id} = ${payoutItemCommissions.payoutItemId}
         where ${payoutItems.payoutBatchId} = ${qualified(payoutBatches.id)})`,
    })
    .from(payoutBatches)
    .where(and(eq(payoutBatches.id, batchId), eq(payoutBatches.workspaceId, workspaceId)))
    .limit(1)
  return row ?? null
}

/** Who is in a batch: one row per affiliate participation, largest first. */
export async function listBatchItems(tx: DbClient, batchId: string, limit = 500) {
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
      commissionCount: sql<number>`(
        select count(*)::int from ${payoutItemCommissions}
         where ${payoutItemCommissions.payoutItemId} = ${qualified(payoutItems.id)})`,
    })
    .from(payoutItems)
    .innerJoin(programAffiliates, eq(programAffiliates.id, payoutItems.programAffiliateId))
    .innerJoin(affiliates, eq(affiliates.id, programAffiliates.affiliateId))
    .where(eq(payoutItems.payoutBatchId, batchId))
    .orderBy(desc(payoutItems.amountMinor), payoutItems.id)
    .limit(limit)
}
