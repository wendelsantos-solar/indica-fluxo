import "server-only"

import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm"

import { type DbClient } from "@/server/db"
import {
  affiliates,
  commissions,
  customers,
  payoutBatches,
  payoutItems,
  programAffiliates,
  programs,
  transactions,
} from "@/server/db/schema"

export type CommissionStatus =
  | "pending"
  | "available"
  | "approved"
  | "paid"
  | "reversed"
  | "rejected"

export interface CommissionListParams {
  workspaceId: string
  programId?: string
  participationId?: string
  statuses?: CommissionStatus[]
  from?: Date
  to?: Date
  limit?: number
  offset?: number
}

export interface CommissionListRow {
  id: string
  affiliateName: string
  affiliateCode: string
  programName: string
  customerRef: string
  transactionRef: string
  currency: string
  baseAmountMinor: number
  commissionRate: number | null
  commissionAmountMinor: number
  status: CommissionStatus
  eligibleAt: Date
  createdAt: Date
  ruleApplied: string | null
}

function filters(params: CommissionListParams): SQL | undefined {
  const parts: SQL[] = [eq(commissions.workspaceId, params.workspaceId)]
  if (params.programId) parts.push(eq(commissions.programId, params.programId))
  if (params.participationId) {
    parts.push(eq(commissions.programAffiliateId, params.participationId))
  }
  if (params.statuses?.length) parts.push(inArray(commissions.status, params.statuses))
  if (params.from) parts.push(gte(commissions.createdAt, params.from))
  if (params.to) parts.push(lte(commissions.createdAt, params.to))
  return and(...parts)
}

export async function listCommissions(
  tx: DbClient,
  params: CommissionListParams,
): Promise<{ rows: CommissionListRow[]; total: number; totalAmountMinor: number }> {
  const where = filters(params)

  const rows = await tx
    .select({
      id: commissions.id,
      affiliateName: affiliates.name,
      affiliateCode: programAffiliates.code,
      programName: programs.name,
      customerRef: sql<string>`coalesce(${customers.externalId}, ${customers.providerCustomerId}, left(${customers.id}::text, 8))`,
      transactionRef: transactions.providerTransactionId,
      currency: commissions.currency,
      baseAmountMinor: commissions.baseAmountMinor,
      commissionRate: commissions.commissionRate,
      commissionAmountMinor: commissions.commissionAmountMinor,
      status: commissions.status,
      eligibleAt: commissions.eligibleAt,
      createdAt: commissions.createdAt,
      ruleApplied: commissions.ruleApplied,
    })
    .from(commissions)
    .innerJoin(programAffiliates, eq(programAffiliates.id, commissions.programAffiliateId))
    .innerJoin(affiliates, eq(affiliates.id, programAffiliates.affiliateId))
    .innerJoin(programs, eq(programs.id, commissions.programId))
    .innerJoin(customers, eq(customers.id, commissions.customerId))
    .innerJoin(transactions, eq(transactions.id, commissions.transactionId))
    .where(where)
    .orderBy(desc(commissions.createdAt))
    .limit(params.limit ?? 50)
    .offset(params.offset ?? 0)

  const [totals] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      amount: sql<number>`coalesce(sum(${commissions.commissionAmountMinor}), 0)::int`,
    })
    .from(commissions)
    .where(where)

  return {
    rows,
    total: totals?.total ?? 0,
    totalAmountMinor: totals?.amount ?? 0,
  }
}

/**
 * `pending` matures into `available` purely by the clock, so the promotion is a
 * single idempotent UPDATE rather than a background worker. See DATABASE.md §3.
 */
export async function promoteEligibleCommissions(
  tx: DbClient,
  workspaceId: string,
  now = new Date(),
): Promise<number> {
  const updated = await tx
    .update(commissions)
    .set({ status: "available", updatedAt: now })
    .where(
      and(
        eq(commissions.workspaceId, workspaceId),
        eq(commissions.status, "pending"),
        lte(commissions.eligibleAt, now),
      ),
    )
    .returning({ id: commissions.id })

  return updated.length
}

export interface PayableAffiliate {
  participationId: string
  affiliateId: string
  affiliateName: string
  affiliateEmail: string
  code: string
  currency: string
  amountMinor: number
  commissionCount: number
}

/** What the founder actually owes right now, grouped by affiliate and currency. */
export async function listPayableByAffiliate(
  tx: DbClient,
  workspaceId: string,
): Promise<PayableAffiliate[]> {
  return tx
    .select({
      participationId: commissions.programAffiliateId,
      affiliateId: affiliates.id,
      affiliateName: affiliates.name,
      affiliateEmail: affiliates.email,
      code: programAffiliates.code,
      currency: commissions.currency,
      amountMinor: sql<number>`sum(${commissions.commissionAmountMinor})::int`,
      commissionCount: sql<number>`count(*)::int`,
    })
    .from(commissions)
    .innerJoin(programAffiliates, eq(programAffiliates.id, commissions.programAffiliateId))
    .innerJoin(affiliates, eq(affiliates.id, programAffiliates.affiliateId))
    .where(
      and(
        eq(commissions.workspaceId, workspaceId),
        inArray(commissions.status, ["available", "approved"]),
      ),
    )
    .groupBy(
      commissions.programAffiliateId,
      affiliates.id,
      affiliates.name,
      affiliates.email,
      programAffiliates.code,
      commissions.currency,
    )
    .having(sql`sum(${commissions.commissionAmountMinor}) > 0`)
    .orderBy(sql`sum(${commissions.commissionAmountMinor}) desc`)
}

export interface AffiliateCommissionRow {
  id: string
  programName: string
  customerRef: string
  currency: string
  baseAmountMinor: number
  commissionRate: number | null
  commissionAmountMinor: number
  status: CommissionStatus
  eligibleAt: Date
  createdAt: Date
}

/** The affiliate's own ledger. RLS already limits this to their rows. */
export async function listCommissionsForAffiliate(
  tx: DbClient,
  participationIds: string[],
  limit = 100,
): Promise<AffiliateCommissionRow[]> {
  if (participationIds.length === 0) return []

  return tx
    .select({
      id: commissions.id,
      programName: programs.name,
      customerRef: sql<string>`coalesce(${customers.externalId}, ${customers.providerCustomerId}, left(${customers.id}::text, 8))`,
      currency: commissions.currency,
      baseAmountMinor: commissions.baseAmountMinor,
      commissionRate: commissions.commissionRate,
      commissionAmountMinor: commissions.commissionAmountMinor,
      status: commissions.status,
      eligibleAt: commissions.eligibleAt,
      createdAt: commissions.createdAt,
    })
    .from(commissions)
    .innerJoin(programs, eq(programs.id, commissions.programId))
    .innerJoin(customers, eq(customers.id, commissions.customerId))
    .where(inArray(commissions.programAffiliateId, participationIds))
    .orderBy(desc(commissions.createdAt))
    .limit(limit)
}

export interface AffiliatePayoutRow {
  id: string
  reference: string
  amountMinor: number
  currency: string
  status: "pending" | "paid" | "failed" | "cancelled"
  paidAt: Date | null
  externalReference: string | null
}

export async function listPayoutsForAffiliate(
  tx: DbClient,
  participationIds: string[],
): Promise<AffiliatePayoutRow[]> {
  if (participationIds.length === 0) return []

  return tx
    .select({
      id: payoutItems.id,
      reference: payoutBatches.reference,
      amountMinor: payoutItems.amountMinor,
      currency: payoutItems.currency,
      status: payoutItems.status,
      paidAt: payoutItems.paidAt,
      externalReference: payoutItems.externalReference,
    })
    .from(payoutItems)
    .innerJoin(payoutBatches, eq(payoutBatches.id, payoutItems.payoutBatchId))
    .where(inArray(payoutItems.programAffiliateId, participationIds))
    .orderBy(desc(payoutItems.createdAt))
}
