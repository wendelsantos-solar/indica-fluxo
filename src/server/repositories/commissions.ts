import "server-only"

import { and, desc, eq, gt, gte, inArray, lte, sql, type SQL } from "drizzle-orm"

import { orderMoneyTotals, toMoneyTotals, type MoneyTotal } from "@/lib/money-totals"
import { type DbClient } from "@/server/db"
import { qualified } from "@/server/db/qualify"
import {
  affiliates,
  commissions,
  customers,
  payoutBatches,
  payoutItemCommissions,
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

/**
 * The status a reader should see. SQL mirror of `effectiveCommissionStatus` in
 * `server/domain/commission.ts`, which stays the single definition of the rule:
 * `pending` whose `eligible_at` has passed *is* `available`, whether or not
 * `promoteEligibleCommissions` has written that down yet. Reads use this so a
 * GET never has to UPDATE the ledger to show the truth.
 *
 * `alias` is for raw `tx.execute` queries that alias the table (`commissions c`);
 * the query builder passes nothing and gets table-qualified columns.
 */
export function effectiveCommissionStatusSql(alias?: string): SQL<CommissionStatus> {
  const status = alias ? sql`${sql.identifier(alias)}.status` : sql`${commissions.status}`
  const eligibleAt = alias
    ? sql`${sql.identifier(alias)}.eligible_at`
    : sql`${commissions.eligibleAt}`
  return sql<CommissionStatus>`(case when ${status} = 'pending' and ${eligibleAt} <= now() then 'available' else ${status} end)`
}

function filters(params: CommissionListParams): SQL | undefined {
  const parts: SQL[] = [eq(commissions.workspaceId, params.workspaceId)]
  if (params.programId) parts.push(eq(commissions.programId, params.programId))
  if (params.participationId) {
    parts.push(eq(commissions.programAffiliateId, params.participationId))
  }
  // Filter on the *effective* status: a matured `pending` row is listed under
  // `available`, and no longer under `pending`.
  if (params.statuses?.length) {
    parts.push(inArray(effectiveCommissionStatusSql(), params.statuses))
  }
  if (params.from) parts.push(gte(commissions.createdAt, params.from))
  if (params.to) parts.push(lte(commissions.createdAt, params.to))
  return and(...parts)
}

export interface CommissionListResult {
  rows: CommissionListRow[]
  total: number
  /**
   * Sum of the filtered commissions, one entry per currency, largest first.
   * Never collapsed into one number: the ledger holds whatever currency each
   * program pays in.
   */
  totals: MoneyTotal[]
}

export async function listCommissions(
  tx: DbClient,
  params: CommissionListParams,
): Promise<CommissionListResult> {
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
      status: effectiveCommissionStatusSql(),
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

  // `bigint`, not `int`: a workspace's lifetime commissions overflow int4 at
  // 21 474 836,47 in a two-decimal currency.
  const byCurrency = await tx
    .select({
      currency: commissions.currency,
      count: sql<number>`count(*)::int`.mapWith(Number),
      amountMinor: sql<number>`coalesce(sum(${commissions.commissionAmountMinor}), 0)::bigint`.mapWith(Number),
    })
    .from(commissions)
    .where(where)
    .groupBy(commissions.currency)

  return {
    rows,
    total: byCurrency.reduce((sum, row) => sum + row.count, 0),
    totals: orderMoneyTotals(toMoneyTotals(byCurrency)),
  }
}

/**
 * `pending` matures into `available` purely by the clock, so the promotion is a
 * single idempotent UPDATE rather than a background worker. See DATABASE.md §3.
 *
 * Not for GET renders: reads use `effectiveCommissionStatusSql` instead. This
 * persists the promotion where it matters — inside the transaction that locks
 * commissions into a payout batch, and in the seed.
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

/**
 * A commission the founder can put in a batch right now. Shared by this read
 * and `createPayoutBatch()`, so what the page offers is what a batch claims.
 *
 * - `pending` past its `eligible_at` counts as available. It is the same rule
 *   as `effectiveCommissionStatus()` in `server/domain/commission.ts`, applied
 *   in SQL so a GET render never has to UPDATE the ledger to be correct.
 * - `approved` is the status a batch gives the commissions it snapshots, so a
 *   commission already held by a batch that was not cancelled is excluded —
 *   otherwise it could be batched, and paid, twice.
 *
 * Columns are `qualified()` so the sub-query can never resolve a bare `"id"`
 * against `payout_items` if this is used in a single-table select.
 */
export function payableCommissionFilter(now: SQL = sql`now()`): SQL {
  return sql`(
    (${qualified(commissions.status)} in ('available', 'approved')
      or (${qualified(commissions.status)} = 'pending' and ${qualified(commissions.eligibleAt)} <= ${now}))
    and not exists (
      select 1 from ${payoutItemCommissions}
        join ${payoutItems} on ${payoutItems.id} = ${payoutItemCommissions.payoutItemId}
       where ${payoutItemCommissions.commissionId} = ${qualified(commissions.id)}
         and ${payoutItems.status} <> 'cancelled'))`
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
      // `bigint`, never `int`: a workspace's payable total can pass 2^31 minor
      // units. Never summed across currencies — `currency` is in the GROUP BY.
      amountMinor: sql<number>`sum(${commissions.commissionAmountMinor})::bigint`.mapWith(Number),
      commissionCount: sql<number>`count(*)::int`,
    })
    .from(commissions)
    .innerJoin(programAffiliates, eq(programAffiliates.id, commissions.programAffiliateId))
    .innerJoin(affiliates, eq(affiliates.id, programAffiliates.affiliateId))
    .where(and(eq(commissions.workspaceId, workspaceId), payableCommissionFilter()))
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

/**
 * The affiliate's own ledger. RLS already limits this to their rows.
 *
 * `customers` is a left join on purpose: affiliates have no RLS read on the
 * customers table (a customer belongs to the workspace, not to the partner who
 * referred them), so an inner join silently returned zero rows for every
 * affiliate. The reference falls back to a short id of the commission's
 * customer, which is all the portal shows anyway.
 *
 * `kind: "conversions"` keeps only positive rows — a payment that earned —
 * so the Conversions page paginates over what it shows instead of filtering a
 * page after the fact. Reversal rows are the commission side of a refund.
 */
export async function listCommissionsForAffiliate(
  tx: DbClient,
  participationIds: string[],
  options: { limit?: number; offset?: number; kind?: "all" | "conversions" } = {},
): Promise<{ rows: AffiliateCommissionRow[]; total: number }> {
  if (participationIds.length === 0) return { rows: [], total: 0 }

  const { limit = 25, offset = 0, kind = "all" } = options
  const where = and(
    inArray(commissions.programAffiliateId, participationIds),
    kind === "conversions" ? gt(commissions.commissionAmountMinor, 0) : undefined,
  )

  const [totals] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(commissions)
    .where(where)

  const rows = await tx
    .select({
      id: commissions.id,
      programName: programs.name,
      customerRef: sql<string>`coalesce(${customers.externalId}, ${customers.providerCustomerId}, left(${commissions.customerId}::text, 8))`,
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
    .leftJoin(customers, eq(customers.id, commissions.customerId))
    .where(where)
    // `id` breaks ties so a page boundary never repeats or skips a row.
    .orderBy(desc(commissions.createdAt), desc(commissions.id))
    .limit(limit)
    .offset(offset)

  return { rows, total: totals?.value ?? 0 }
}

export const PAYOUT_HISTORY_LIMIT = 100

export interface AffiliatePayoutRow {
  id: string
  reference: string
  amountMinor: number
  currency: string
  status: "pending" | "paid" | "failed" | "cancelled"
  paidAt: Date | null
  externalReference: string | null
}

/**
 * The affiliate's payout history, newest first. Bounded like every list read
 * (ARCHITECTURE.md §6): payouts are a few per month, so the most recent
 * `limit` rows are the whole useful history; the page says when it is cut.
 */
export async function listPayoutsForAffiliate(
  tx: DbClient,
  participationIds: string[],
  limit = PAYOUT_HISTORY_LIMIT,
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
    .orderBy(desc(payoutItems.createdAt), desc(payoutItems.id))
    .limit(limit)
}
