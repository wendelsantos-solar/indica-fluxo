import "server-only"

import { and, count, desc, eq, sql } from "drizzle-orm"

import { orderMoneyTotals, toMoneyTotals, type MoneyTotal } from "@/lib/money-totals"
import { type DbClient } from "@/server/db"
import { qualified } from "@/server/db/qualify"
import { affiliates, commissions, programAffiliates, programs, referralClicks } from "@/server/db/schema"
import type { ProgramRules } from "@/server/domain/types"

export type ProgramRow = typeof programs.$inferSelect

export async function listPrograms(tx: DbClient, workspaceId: string) {
  return tx
    .select({
      id: programs.id,
      name: programs.name,
      slug: programs.slug,
      description: programs.description,
      websiteUrl: programs.websiteUrl,
      status: programs.status,
      environment: programs.environment,
      commissionType: programs.commissionType,
      commissionValue: programs.commissionValue,
      commissionDurationMonths: programs.commissionDurationMonths,
      attributionModel: programs.attributionModel,
      attributionWindowDays: programs.attributionWindowDays,
      commissionHoldDays: programs.commissionHoldDays,
      currency: programs.currency,
      createdAt: programs.createdAt,
      affiliateCount: sql<number>`(
        select count(*)::int from ${programAffiliates}
         where ${programAffiliates.programId} = ${qualified(programs.id)}
           and ${programAffiliates.status} = 'approved'
      )`,
      clickCount: sql<number>`(
        select count(*)::int from ${referralClicks}
         where ${referralClicks.programId} = ${qualified(programs.id)}
      )`,
      // Per currency: a program's currency is editable, so its ledger can hold
      // more than one. Amounts travel as text inside the JSON so a `bigint`
      // never passes through a JSON number, then become integers again.
      commissionTotals: sql<MoneyTotal[]>`coalesce((
        select json_agg(json_build_object('currency', totals.currency, 'amountMinor', totals.amount_minor::text))
          from (
            select ${commissions.currency} as currency,
                   sum(${commissions.commissionAmountMinor})::bigint as amount_minor
              from ${commissions}
             where ${commissions.programId} = ${qualified(programs.id)}
               and ${commissions.status} <> 'rejected'
             group by ${commissions.currency}
          ) totals
      ), '[]'::json)`.mapWith(parseMoneyTotalsJson),
    })
    .from(programs)
    .where(eq(programs.workspaceId, workspaceId))
    .orderBy(desc(programs.createdAt))
}

/** `json_agg` output → totals. The driver may hand over parsed JSON or text. */
function parseMoneyTotalsJson(value: unknown): MoneyTotal[] {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value
  if (!Array.isArray(parsed)) return []
  return toMoneyTotals(
    parsed.flatMap((entry: unknown) => {
      if (typeof entry !== "object" || entry === null) return []
      const { currency, amountMinor } = entry as Record<string, unknown>
      if (typeof currency !== "string") return []
      if (typeof amountMinor !== "string" && typeof amountMinor !== "number") return []
      return [{ currency, amountMinor }]
    }),
  )
}

export interface ProgramTotals {
  clicks: number
  /** Distinct customers who earned a positive commission. */
  customers: number
  /** Net base amount of the program's commissions, per currency. */
  revenue: MoneyTotal[]
  commission: MoneyTotal[]
}

/**
 * Program-level totals aggregated in SQL over every participation — not summed
 * from a capped list of affiliates (D3). Same definitions as `listAffiliates`
 * per row: rejected commissions do not count, reversals net out.
 */
export async function getProgramTotals(tx: DbClient, programId: string): Promise<ProgramTotals> {
  const [counts] = await tx.execute<{ clicks: number; customers: number }>(sql`
    select
      (select count(*) from referral_clicks where program_id = ${programId})::int as clicks,
      (select count(distinct customer_id) from commissions
        where program_id = ${programId} and commission_amount_minor > 0)::int as customers
  `)

  const money = await tx.execute<{ currency: string; revenue_minor: string; commission_minor: string }>(sql`
    select
      currency,
      coalesce(sum(base_amount_minor), 0)::bigint as revenue_minor,
      coalesce(sum(commission_amount_minor), 0)::bigint as commission_minor
    from commissions
    where program_id = ${programId} and status <> 'rejected'
    group by currency
  `)

  return {
    clicks: Number(counts?.clicks ?? 0),
    customers: Number(counts?.customers ?? 0),
    revenue: orderMoneyTotals(
      toMoneyTotals(money.map((row) => ({ currency: row.currency, amountMinor: row.revenue_minor }))),
    ),
    commission: orderMoneyTotals(
      toMoneyTotals(money.map((row) => ({ currency: row.currency, amountMinor: row.commission_minor }))),
    ),
  }
}

/**
 * The counts on a program's tabs, without loading either list: only the active
 * tab reads its rows. Same definitions as the lists' own totals —
 * `listAffiliates({ programId })` (participations of this workspace's
 * affiliates) and `listCommissions({ programId })` (every commission row).
 */
export async function countProgramTabs(
  tx: DbClient,
  workspaceId: string,
  programId: string,
): Promise<{ affiliates: number; commissions: number }> {
  const [row] = await tx
    .select({
      affiliates: sql<number>`(
        select count(*)::int from ${programAffiliates}
          join ${affiliates} on ${affiliates.id} = ${programAffiliates.affiliateId}
         where ${programAffiliates.programId} = ${programId}
           and ${affiliates.workspaceId} = ${workspaceId})`,
      commissions: sql<number>`(
        select count(*)::int from ${commissions}
         where ${commissions.programId} = ${programId}
           and ${commissions.workspaceId} = ${workspaceId})`,
    })
    .from(programs)
    .where(and(eq(programs.id, programId), eq(programs.workspaceId, workspaceId)))
    .limit(1)
  return { affiliates: Number(row?.affiliates ?? 0), commissions: Number(row?.commissions ?? 0) }
}

export async function findProgramBySlug(tx: DbClient, workspaceId: string, slug: string) {
  const [row] = await tx
    .select()
    .from(programs)
    .where(and(eq(programs.workspaceId, workspaceId), eq(programs.slug, slug)))
    .limit(1)
  return row ?? null
}

export async function findProgramById(tx: DbClient, programId: string) {
  const [row] = await tx.select().from(programs).where(eq(programs.id, programId)).limit(1)
  return row ?? null
}

export async function countPrograms(tx: DbClient, workspaceId: string): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(programs)
    .where(eq(programs.workspaceId, workspaceId))
  return row?.value ?? 0
}

/** Maps a persisted program onto the pure domain shape the engine consumes. */
export function toProgramRules(row: ProgramRow): ProgramRules {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    currency: row.currency,
    commissionType: row.commissionType,
    commissionValue: row.commissionValue,
    commissionDurationMonths: row.commissionDurationMonths,
    attributionModel: row.attributionModel,
    attributionWindowDays: row.attributionWindowDays,
    commissionHoldDays: row.commissionHoldDays,
  }
}
