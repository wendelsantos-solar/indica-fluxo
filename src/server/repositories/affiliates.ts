import "server-only"

import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm"

import { orderMoneyTotals, toMoneyTotals, type MoneyTotal } from "@/lib/money-totals"
import type { ViewEnvironment } from "@/lib/view-environment"
import { type DbClient } from "@/server/db"
import { qualified } from "@/server/db/qualify"
import {
  affiliates,
  commissions,
  programAffiliates,
  programs,
  referralClicks,
  referralLinks,
} from "@/server/db/schema"
import type { ParticipationRules } from "@/server/domain/types"
import { commissionInEnvironment } from "@/server/repositories/commissions"

export interface AffiliateListRow {
  affiliateId: string
  participationId: string | null
  name: string
  email: string
  companyName: string | null
  country: string | null
  status: "invited" | "active" | "suspended"
  participationStatus: "pending" | "approved" | "rejected" | "suspended" | null
  code: string | null
  programId: string | null
  programName: string | null
  /**
   * The program's currency: what `revenueMinor` and `commissionMinor` are in.
   * Null only for an affiliate with no participation, whose sums are zero.
   */
  currency: string | null
  programCommissionType: "percentage" | "fixed" | null
  programCommissionValue: number | null
  customCommissionType: "percentage" | "fixed" | null
  customCommissionValue: number | null
  clicks: number
  customers: number
  revenueMinor: number
  commissionMinor: number
  /**
   * The participation also has commissions in a currency other than the
   * program's (the program's currency was changed). Those are left out of the
   * sums rather than added to them — see DATABASE.md §4.
   */
  hasOtherCurrencies: boolean
  joinedAt: Date
}

export type AffiliateSortField = "name" | "joined" | "revenue" | "commission"

export interface AffiliateListParams {
  workspaceId: string
  /**
   * Only participations in programs of this environment (plus affiliates with
   * no participation yet, who belong to neither). A list narrowed to one
   * program may omit it.
   */
  environment?: ViewEnvironment
  programId?: string
  search?: string
  status?: "pending" | "approved" | "rejected" | "suspended"
  /** Defaults to the newest affiliate first. */
  sort?: { field: AffiliateSortField; dir: "asc" | "desc" }
  limit?: number
  offset?: number
}

/**
 * One aggregate query rather than N per-affiliate lookups. The counts are
 * correlated subqueries so the join fan-out cannot double-count revenue.
 */
export async function listAffiliates(
  tx: DbClient,
  params: AffiliateListParams,
): Promise<{ rows: AffiliateListRow[]; total: number }> {
  const { workspaceId, environment, programId, search, status, sort, limit = 25, offset = 0 } = params

  const filters: SQL[] = [eq(affiliates.workspaceId, workspaceId)]
  if (environment) {
    filters.push(sql`(${programAffiliates.id} is null or ${programs.environment} = ${environment})`)
  }
  if (programId) filters.push(eq(programAffiliates.programId, programId))
  if (status) filters.push(eq(programAffiliates.status, status))
  if (search) {
    const term = `%${search}%`
    const match = or(
      ilike(affiliates.name, term),
      ilike(affiliates.email, term),
      ilike(affiliates.companyName, term),
      ilike(programAffiliates.code, term),
    )
    if (match) filters.push(match)
  }

  const where = and(...filters)

  // Sums in the program's own currency only (see `hasOtherCurrencies`).
  const revenueSum = sql<number>`coalesce((
        select sum(${commissions.baseAmountMinor}) from ${commissions}
         where ${commissions.programAffiliateId} = ${programAffiliates.id}
           and ${commissions.currency} = ${programs.currency}
           and ${commissions.status} <> 'rejected'), 0)::bigint`
  const commissionSum = sql<number>`coalesce((
        select sum(${commissions.commissionAmountMinor}) from ${commissions}
         where ${commissions.programAffiliateId} = ${programAffiliates.id}
           and ${commissions.currency} = ${programs.currency}
           and ${commissions.status} <> 'rejected'), 0)::bigint`

  // Whitelisted columns only. Money is ordered by minor units, grouped by
  // currency first so a BRL row is never ranked against a USD one.
  const by = sort?.dir === "asc" ? asc : desc
  const order: SQL[] =
    sort?.field === "name"
      ? [by(sql`lower(${affiliates.name})`), desc(affiliates.createdAt)]
      : sort?.field === "revenue"
        ? [asc(programs.currency), by(revenueSum), asc(affiliates.name)]
        : sort?.field === "commission"
          ? [asc(programs.currency), by(commissionSum), asc(affiliates.name)]
          : sort?.field === "joined"
            ? [by(affiliates.createdAt), by(programAffiliates.createdAt)]
            : [desc(affiliates.createdAt), desc(programAffiliates.createdAt)]

  const rows = await tx
    .select({
      affiliateId: affiliates.id,
      participationId: programAffiliates.id,
      name: affiliates.name,
      email: affiliates.email,
      companyName: affiliates.companyName,
      country: affiliates.country,
      status: affiliates.status,
      participationStatus: programAffiliates.status,
      code: programAffiliates.code,
      programId: programAffiliates.programId,
      programName: programs.name,
      currency: programs.currency,
      programCommissionType: programs.commissionType,
      programCommissionValue: programs.commissionValue,
      customCommissionType: programAffiliates.customCommissionType,
      customCommissionValue: programAffiliates.customCommissionValue,
      joinedAt: affiliates.createdAt,
      clicks: sql<number>`coalesce((
        select count(*)::int from ${referralClicks}
         where ${referralClicks.programAffiliateId} = ${programAffiliates.id}), 0)`,
      customers: sql<number>`coalesce((
        select count(distinct ${commissions.customerId})::int from ${commissions}
         where ${commissions.programAffiliateId} = ${programAffiliates.id}
           and ${commissions.commissionAmountMinor} > 0), 0)`,
      // Money sums stay `bigint` (an `int` cast overflows past 2^31 minor
      // units) and are read back as a JS number, and only ever add up
      // commissions in the program's own currency.
      revenueMinor: revenueSum.mapWith(Number),
      commissionMinor: commissionSum.mapWith(Number),
      hasOtherCurrencies: sql<boolean>`exists (
        select 1 from ${commissions}
         where ${commissions.programAffiliateId} = ${programAffiliates.id}
           and ${commissions.currency} <> ${programs.currency}
           and ${commissions.status} <> 'rejected')`,
    })
    .from(affiliates)
    .leftJoin(programAffiliates, eq(programAffiliates.affiliateId, affiliates.id))
    .leftJoin(programs, eq(programs.id, programAffiliates.programId))
    .where(where)
    .orderBy(...order, programAffiliates.id)
    .limit(limit)
    .offset(offset)

  const [totals] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(affiliates)
    .leftJoin(programAffiliates, eq(programAffiliates.affiliateId, affiliates.id))
    .leftJoin(programs, eq(programs.id, programAffiliates.programId))
    .where(where)

  return { rows, total: totals?.value ?? 0 }
}

/**
 * A participation, only if its program belongs to `workspaceId`. RLS lets an
 * admin of two workspaces see both; this keeps a mutation addressed to one
 * workspace from landing in the other.
 */
export async function findParticipationInWorkspace(
  tx: DbClient,
  workspaceId: string,
  participationId: string,
) {
  const [row] = await tx
    .select({
      id: programAffiliates.id,
      status: programAffiliates.status,
      affiliateId: programAffiliates.affiliateId,
      programId: programAffiliates.programId,
      programCurrency: programs.currency,
    })
    .from(programAffiliates)
    .innerJoin(programs, eq(programs.id, programAffiliates.programId))
    .where(and(eq(programAffiliates.id, participationId), eq(programs.workspaceId, workspaceId)))
    .limit(1)
  return row ?? null
}

export async function findParticipationByCode(
  tx: DbClient,
  programId: string,
  code: string,
) {
  const [row] = await tx
    .select({
      id: programAffiliates.id,
      programId: programAffiliates.programId,
      affiliateId: programAffiliates.affiliateId,
      status: programAffiliates.status,
      customCommissionType: programAffiliates.customCommissionType,
      customCommissionValue: programAffiliates.customCommissionValue,
    })
    .from(programAffiliates)
    .where(and(eq(programAffiliates.programId, programId), eq(programAffiliates.code, code)))
    .limit(1)
  return row ?? null
}

export async function findParticipationById(tx: DbClient, participationId: string) {
  const [row] = await tx
    .select({
      id: programAffiliates.id,
      programId: programAffiliates.programId,
      affiliateId: programAffiliates.affiliateId,
      status: programAffiliates.status,
      code: programAffiliates.code,
      customCommissionType: programAffiliates.customCommissionType,
      customCommissionValue: programAffiliates.customCommissionValue,
      affiliateName: affiliates.name,
      affiliateEmail: affiliates.email,
      workspaceId: affiliates.workspaceId,
    })
    .from(programAffiliates)
    .innerJoin(affiliates, eq(affiliates.id, programAffiliates.affiliateId))
    .where(eq(programAffiliates.id, participationId))
    .limit(1)
  return row ?? null
}

export function toParticipationRules(row: {
  id: string
  programId: string
  affiliateId: string
  status: "pending" | "approved" | "rejected" | "suspended"
  customCommissionType: "percentage" | "fixed" | null
  customCommissionValue: number | null
}): ParticipationRules {
  return {
    id: row.id,
    programId: row.programId,
    affiliateId: row.affiliateId,
    status: row.status,
    customCommissionType: row.customCommissionType,
    customCommissionValue: row.customCommissionValue,
  }
}

/**
 * Every participation belonging to the signed-in affiliate, with its program.
 *
 * `programStatus` and `programWebsiteUrl` are what the portal needs to say
 * whether a link earns (`recordClick` credits a click only while the program is
 * `active`) and where the default link points. Both come through the
 * `programs_affiliate_select` policy, which exposes the enrolled program's row.
 */
/** Whether the user takes part in any program — without loading the participations. */
export async function userHasParticipation(tx: DbClient, userId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: programAffiliates.id })
    .from(affiliates)
    .innerJoin(programAffiliates, eq(programAffiliates.affiliateId, affiliates.id))
    .where(eq(affiliates.userId, userId))
    .limit(1)
  return Boolean(row)
}

export async function listParticipationsForUser(tx: DbClient, userId: string) {
  return tx
    .select({
      participationId: programAffiliates.id,
      code: programAffiliates.code,
      status: programAffiliates.status,
      affiliateId: affiliates.id,
      affiliateName: affiliates.name,
      workspaceId: affiliates.workspaceId,
      programId: programs.id,
      programName: programs.name,
      programStatus: programs.status,
      programWebsiteUrl: programs.websiteUrl,
      programCurrency: programs.currency,
      commissionType: programs.commissionType,
      commissionValue: programs.commissionValue,
      commissionDurationMonths: programs.commissionDurationMonths,
      customCommissionType: programAffiliates.customCommissionType,
      customCommissionValue: programAffiliates.customCommissionValue,
    })
    .from(affiliates)
    .innerJoin(programAffiliates, eq(programAffiliates.affiliateId, affiliates.id))
    .innerJoin(programs, eq(programs.id, programAffiliates.programId))
    .where(eq(affiliates.userId, userId))
    .orderBy(desc(programAffiliates.createdAt))
}

export async function listLinks(tx: DbClient, participationId: string) {
  return tx
    .select({
      id: referralLinks.id,
      name: referralLinks.name,
      code: referralLinks.code,
      destinationUrl: referralLinks.destinationUrl,
      campaign: referralLinks.campaign,
      createdAt: referralLinks.createdAt,
      clicks: sql<number>`coalesce((
        select count(*)::int from ${referralClicks}
         where ${referralClicks.referralLinkId} = ${qualified(referralLinks.id)}), 0)`,
    })
    .from(referralLinks)
    .where(eq(referralLinks.programAffiliateId, participationId))
    .orderBy(desc(referralLinks.createdAt))
}

/**
 * Aggregate KPIs for one participation — the affiliate portal home. Every money
 * figure is in the participation's program currency; callers group by it and
 * never add two participations in different currencies together.
 *
 * Sums are `bigint` (an `int` cast overflows past 2 147 483 647 minor units)
 * and come back from the driver as strings, hence `mapWith(Number)`.
 *
 * Revenue is the commissions' `base_amount_minor`, not `transactions`: an
 * affiliate has no RLS read on transactions (they belong to the workspace), so
 * a join there silently summed to zero for every affiliate.
 */
export async function participationStats(tx: DbClient, participationId: string) {
  const [row] = await tx
    .select({
      clicks: sql<number>`coalesce((
        select count(*)::int from ${referralClicks}
         where ${referralClicks.programAffiliateId} = ${participationId}), 0)`,
      customers: sql<number>`coalesce((
        select count(distinct ${commissions.customerId})::int from ${commissions}
         where ${commissions.programAffiliateId} = ${participationId}
           and ${commissions.commissionAmountMinor} > 0), 0)`,
      revenueMinor: sql<number>`coalesce((
        select sum(${commissions.baseAmountMinor}) from ${commissions}
         where ${commissions.programAffiliateId} = ${participationId}
           and ${commissions.commissionAmountMinor} > 0
           and ${commissions.status} <> 'rejected'), 0)::bigint`.mapWith(Number),
      commissionMinor: sql<number>`coalesce((
        select sum(${commissions.commissionAmountMinor}) from ${commissions}
         where ${commissions.programAffiliateId} = ${participationId}
           and ${commissions.status} <> 'rejected'), 0)::bigint`.mapWith(Number),
      paidMinor: sql<number>`coalesce((
        select sum(${commissions.commissionAmountMinor}) from ${commissions}
         where ${commissions.programAffiliateId} = ${participationId}
           and ${commissions.status} = 'paid'), 0)::bigint`.mapWith(Number),
      pendingMinor: sql<number>`coalesce((
        select sum(${commissions.commissionAmountMinor}) from ${commissions}
         where ${commissions.programAffiliateId} = ${participationId}
           and ${commissions.status} in ('pending','available','approved')), 0)::bigint`.mapWith(Number),
    })
    .from(sql`(select 1) as t`)

  return (
    row ?? {
      clicks: 0,
      customers: 0,
      revenueMinor: 0,
      commissionMinor: 0,
      paidMinor: 0,
      pendingMinor: 0,
    }
  )
}

/** Participations waiting for the founder's decision, across the workspace. */
export async function countPendingParticipations(
  tx: DbClient,
  workspaceId: string,
  environment?: ViewEnvironment,
): Promise<number> {
  const [row] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(programAffiliates)
    .innerJoin(programs, eq(programs.id, programAffiliates.programId))
    .where(
      and(
        eq(programs.workspaceId, workspaceId),
        eq(programAffiliates.status, "pending"),
        environment ? eq(programs.environment, environment) : undefined,
      ),
    )
  return Number(row?.value ?? 0)
}

export interface AffiliateOption {
  id: string
  name: string
}

/**
 * Names for an affiliate filter select, bounded like every list read. `include`
 * is always returned (first) so a filtered page can show the selected name even
 * when that affiliate falls outside the first `limit` alphabetically.
 */
export async function listAffiliateOptions(
  tx: DbClient,
  workspaceId: string,
  options: { include?: string; limit?: number } = {},
): Promise<AffiliateOption[]> {
  const { include, limit = 500 } = options
  return tx
    .select({ id: affiliates.id, name: affiliates.name })
    .from(affiliates)
    .where(eq(affiliates.workspaceId, workspaceId))
    .orderBy(
      ...(include ? [desc(sql`${affiliates.id} = ${include}`)] : []),
      asc(sql`lower(${affiliates.name})`),
      asc(affiliates.id),
    )
    .limit(limit)
}

export interface AffiliateDetailParticipation {
  participationId: string
  programId: string
  programName: string
  programSlug: string
  programEnvironment: ViewEnvironment
  status: "pending" | "approved" | "rejected" | "suspended"
  code: string
  currency: string
  programCommissionType: "percentage" | "fixed"
  programCommissionValue: number
  customCommissionType: "percentage" | "fixed" | null
  customCommissionValue: number | null
  clicks: number
  customers: number
  joinedAt: Date
}

export interface AffiliateDetail {
  id: string
  name: string
  email: string
  companyName: string | null
  country: string | null
  status: "invited" | "active" | "suspended"
  createdAt: Date
  /** Every participation, in both environments: the page badges test programs. */
  participations: AffiliateDetailParticipation[]
  /**
   * Base amounts of the commissions that earned (positive, not rejected), per
   * currency — in `environment` when one is given.
   */
  revenue: MoneyTotal[]
}

/**
 * One affiliate of `workspaceId` with every participation and its counts, or
 * null. Scoped by workspace explicitly, on top of RLS, so an admin of two
 * workspaces cannot open one workspace's affiliate under the other's slug.
 */
export async function getAffiliateDetail(
  tx: DbClient,
  workspaceId: string,
  affiliateId: string,
  environment?: ViewEnvironment,
): Promise<AffiliateDetail | null> {
  const [affiliate] = await tx
    .select({
      id: affiliates.id,
      name: affiliates.name,
      email: affiliates.email,
      companyName: affiliates.companyName,
      country: affiliates.country,
      status: affiliates.status,
      createdAt: affiliates.createdAt,
    })
    .from(affiliates)
    .where(and(eq(affiliates.id, affiliateId), eq(affiliates.workspaceId, workspaceId)))
    .limit(1)
  if (!affiliate) return null

  const participations = await tx
    .select({
      participationId: programAffiliates.id,
      programId: programs.id,
      programName: programs.name,
      programSlug: programs.slug,
      programEnvironment: programs.environment,
      status: programAffiliates.status,
      code: programAffiliates.code,
      currency: programs.currency,
      programCommissionType: programs.commissionType,
      programCommissionValue: programs.commissionValue,
      customCommissionType: programAffiliates.customCommissionType,
      customCommissionValue: programAffiliates.customCommissionValue,
      joinedAt: programAffiliates.createdAt,
      clicks: sql<number>`coalesce((
        select count(*)::int from ${referralClicks}
         where ${referralClicks.programAffiliateId} = ${programAffiliates.id}), 0)`.mapWith(Number),
      customers: sql<number>`coalesce((
        select count(distinct ${commissions.customerId})::int from ${commissions}
         where ${commissions.programAffiliateId} = ${programAffiliates.id}
           and ${commissions.commissionAmountMinor} > 0), 0)`.mapWith(Number),
    })
    .from(programAffiliates)
    .innerJoin(programs, eq(programs.id, programAffiliates.programId))
    .where(and(eq(programAffiliates.affiliateId, affiliateId), eq(programs.workspaceId, workspaceId)))
    .orderBy(desc(programAffiliates.createdAt))

  const revenueRows = await tx
    .select({
      currency: commissions.currency,
      amountMinor: sql<number>`coalesce(sum(${commissions.baseAmountMinor}), 0)::bigint`.mapWith(Number),
    })
    .from(commissions)
    .innerJoin(programAffiliates, eq(programAffiliates.id, commissions.programAffiliateId))
    .where(
      and(
        eq(commissions.workspaceId, workspaceId),
        eq(programAffiliates.affiliateId, affiliateId),
        sql`${commissions.commissionAmountMinor} > 0`,
        sql`${commissions.status} <> 'rejected'`,
        environment ? commissionInEnvironment(environment) : undefined,
      ),
    )
    .groupBy(commissions.currency)

  return {
    ...affiliate,
    participations: participations.map((row) => ({ ...row, currency: row.currency.trim() })),
    revenue: orderMoneyTotals(toMoneyTotals(revenueRows)),
  }
}

/** Every referral link of one affiliate's participations, newest first, bounded. */
export async function listLinksForAffiliate(
  tx: DbClient,
  workspaceId: string,
  affiliateId: string,
  limit = 50,
) {
  return tx
    .select({
      id: referralLinks.id,
      name: referralLinks.name,
      code: referralLinks.code,
      destinationUrl: referralLinks.destinationUrl,
      campaign: referralLinks.campaign,
      createdAt: referralLinks.createdAt,
      programName: programs.name,
      programEnvironment: programs.environment,
      clicks: sql<number>`coalesce((
        select count(*)::int from ${referralClicks}
         where ${referralClicks.referralLinkId} = ${qualified(referralLinks.id)}), 0)`.mapWith(Number),
    })
    .from(referralLinks)
    .innerJoin(programAffiliates, eq(programAffiliates.id, referralLinks.programAffiliateId))
    .innerJoin(programs, eq(programs.id, programAffiliates.programId))
    .where(and(eq(programAffiliates.affiliateId, affiliateId), eq(programs.workspaceId, workspaceId)))
    .orderBy(desc(referralLinks.createdAt))
    .limit(limit)
}

/**
 * Approved participations of one program, by name — who a sandbox simulation
 * can credit. Bounded like every list read.
 */
export async function listApprovedParticipationOptions(
  tx: DbClient,
  workspaceId: string,
  programId: string,
  limit = 200,
): Promise<{ id: string; name: string }[]> {
  return tx
    .select({ id: programAffiliates.id, name: affiliates.name })
    .from(programAffiliates)
    .innerJoin(affiliates, eq(affiliates.id, programAffiliates.affiliateId))
    .innerJoin(programs, eq(programs.id, programAffiliates.programId))
    .where(
      and(
        eq(programAffiliates.programId, programId),
        eq(programs.workspaceId, workspaceId),
        eq(programAffiliates.status, "approved"),
      ),
    )
    .orderBy(asc(sql`lower(${affiliates.name})`), asc(programAffiliates.id))
    .limit(limit)
}

/**
 * Whether the affiliate already takes a slot of the plan's `affiliates` limit —
 * the same rule as `public.workspace_plan_usage` (migration 0010): not
 * suspended, with a pending or approved participation in this workspace. A
 * write that would make an uncounted affiliate counted must check the limit.
 */
export async function isAffiliateCountedTowardPlan(
  tx: DbClient,
  workspaceId: string,
  affiliateId: string,
): Promise<boolean> {
  const { rows: [row] } = await tx.execute<{ counted: boolean }>(sql`
    select exists (
      select 1
        from ${affiliates} a
        join ${programAffiliates} pa on pa.affiliate_id = a.id
        join ${programs} p on p.id = pa.program_id and p.workspace_id = ${workspaceId}
       where a.id = ${affiliateId}
         and a.workspace_id = ${workspaceId}
         and a.status <> 'suspended'
         and pa.status in ('pending', 'approved')
    ) as counted
  `)
  return Boolean(row?.counted)
}

/**
 * Serialises referral-code allocation per workspace for the rest of the
 * transaction. Codes are unique per workspace in practice (the tracker resolves
 * a `ref` across the workspace's programs); the database only enforces them per
 * program, so two concurrent invites could otherwise pick the same code.
 */
export async function lockReferralCodes(tx: DbClient, workspaceId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`referral-code:${workspaceId}`}, 0))`)
}

/** Whether `code` is used by any participation in any program of the workspace. */
export async function referralCodeTaken(tx: DbClient, workspaceId: string, code: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: programAffiliates.id })
    .from(programAffiliates)
    .innerJoin(programs, eq(programs.id, programAffiliates.programId))
    .where(and(eq(programs.workspaceId, workspaceId), eq(programAffiliates.code, code)))
    .limit(1)
  return Boolean(row)
}

/**
 * A participation owned by the signed-in affiliate (`affiliates.user_id`), or
 * null. Being a workspace admin is not enough: the portal acts only on the
 * reader's own participations.
 */
export async function findOwnParticipation(tx: DbClient, userId: string, participationId: string) {
  const [row] = await tx
    .select({
      id: programAffiliates.id,
      status: programAffiliates.status,
      workspaceId: affiliates.workspaceId,
    })
    .from(programAffiliates)
    .innerJoin(affiliates, eq(affiliates.id, programAffiliates.affiliateId))
    .where(and(eq(programAffiliates.id, participationId), eq(affiliates.userId, userId)))
    .limit(1)
  return row ?? null
}
