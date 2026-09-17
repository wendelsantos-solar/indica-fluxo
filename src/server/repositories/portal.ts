import "server-only"

import { and, desc, eq, inArray, sql } from "drizzle-orm"

import { type DbClient } from "@/server/db"
import { qualified } from "@/server/db/qualify"
import {
  affiliates,
  commissions,
  customers,
  programAffiliates,
  programs,
  referralClicks,
  referralLinks,
} from "@/server/db/schema"

import {
  effectiveCommissionStatusSql,
  type AffiliateCommissionRow,
  type CommissionStatus,
} from "./commissions"

/**
 * Read models for the affiliate portal. Every query runs as the affiliate
 * (`withUser`), so RLS limits rows to their own participations; the ids passed
 * in only narrow further. Reads that span participations are batched into one
 * statement rather than one per program.
 */

/** Every participation of the signed-in affiliate, with what the portal shows about its program. */
export async function listPortalParticipations(tx: DbClient, userId: string) {
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
      /** Test programs are badged, and their money is never added to live balances. */
      programEnvironment: programs.environment,
      programDescription: programs.description,
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

export type PortalParticipation = Awaited<ReturnType<typeof listPortalParticipations>>[number]

export interface PortalParticipationStats {
  participationId: string
  clicks: number
  customers: number
  revenueMinor: number
  commissionMinor: number
  paidMinor: number
  /** Effective `available`: hold period over, not yet in a payout batch. */
  availableMinor: number
  /** Effective `pending`: still inside the program's hold period. */
  holdMinor: number
  /** `approved`: included in a payout batch the owner has yet to pay. */
  approvedMinor: number
  /** The earliest `eligible_at` of an earning commission still on hold. */
  nextReleaseAt: Date | null
}

/**
 * KPIs and the unpaid balance for many participations in one statement. Money
 * is in each participation's program currency; callers group by it.
 *
 * The unpaid balance is split by the *effective* status
 * (`effectiveCommissionStatusSql`): a `pending` row whose `eligible_at` has
 * passed counts as available even before anything promotes the stored row.
 * Revenue is `base_amount_minor` of earning commissions, not `transactions`,
 * which affiliates cannot read (see `participationStats`).
 */
export async function portalParticipationStats(
  tx: DbClient,
  participationIds: string[],
): Promise<PortalParticipationStats[]> {
  if (participationIds.length === 0) return []

  const effective = effectiveCommissionStatusSql("c")
  // `sql.param` keeps the id list one array parameter (see `getAffiliateSeries`).
  const { rows } = await tx.execute<{
    participation_id: string
    clicks: number
    customers: number
    revenue_minor: string
    commission_minor: string
    paid_minor: string
    available_minor: string
    hold_minor: string
    approved_minor: string
    next_release_at: string | Date | null
  }>(sql`
    with ids as (select unnest(${sql.param(participationIds)}::uuid[]) as id),
    clicks as (
      select rc.program_affiliate_id as id, count(*)::int as clicks
        from referral_clicks rc
       where rc.program_affiliate_id in (select id from ids)
       group by rc.program_affiliate_id
    ),
    ledger as (
      select
        c.program_affiliate_id as id,
        (count(distinct c.customer_id) filter (where c.commission_amount_minor > 0))::int as customers,
        coalesce(sum(c.base_amount_minor) filter (
          where c.commission_amount_minor > 0 and c.status <> 'rejected'), 0)::bigint as revenue_minor,
        coalesce(sum(c.commission_amount_minor) filter (where c.status <> 'rejected'), 0)::bigint as commission_minor,
        coalesce(sum(c.commission_amount_minor) filter (where c.status = 'paid'), 0)::bigint as paid_minor,
        coalesce(sum(c.commission_amount_minor) filter (where ${effective} = 'available'), 0)::bigint as available_minor,
        coalesce(sum(c.commission_amount_minor) filter (where ${effective} = 'pending'), 0)::bigint as hold_minor,
        coalesce(sum(c.commission_amount_minor) filter (where c.status = 'approved'), 0)::bigint as approved_minor,
        min(c.eligible_at) filter (
          where ${effective} = 'pending' and c.commission_amount_minor > 0) as next_release_at
      from commissions c
      where c.program_affiliate_id in (select id from ids)
      group by c.program_affiliate_id
    )
    select
      ids.id::text as participation_id,
      coalesce(clicks.clicks, 0)::int as clicks,
      coalesce(ledger.customers, 0)::int as customers,
      coalesce(ledger.revenue_minor, 0)::text as revenue_minor,
      coalesce(ledger.commission_minor, 0)::text as commission_minor,
      coalesce(ledger.paid_minor, 0)::text as paid_minor,
      coalesce(ledger.available_minor, 0)::text as available_minor,
      coalesce(ledger.hold_minor, 0)::text as hold_minor,
      coalesce(ledger.approved_minor, 0)::text as approved_minor,
      ledger.next_release_at
    from ids
    left join clicks on clicks.id = ids.id
    left join ledger on ledger.id = ids.id
  `)

  return rows.map((row) => ({
    participationId: row.participation_id,
    clicks: Number(row.clicks),
    customers: Number(row.customers),
    revenueMinor: Number(row.revenue_minor),
    commissionMinor: Number(row.commission_minor),
    paidMinor: Number(row.paid_minor),
    availableMinor: Number(row.available_minor),
    holdMinor: Number(row.hold_minor),
    approvedMinor: Number(row.approved_minor),
    nextReleaseAt: row.next_release_at ? new Date(row.next_release_at) : null,
  }))
}

/** Hard cap on named links read at once; affiliates keep a handful per program. */
export const PORTAL_LINKS_LIMIT = 500

/** Named links of many participations, newest first, with their click counts. */
export async function listPortalLinks(tx: DbClient, participationIds: string[]) {
  if (participationIds.length === 0) return []

  return tx
    .select({
      id: referralLinks.id,
      participationId: referralLinks.programAffiliateId,
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
    .where(inArray(referralLinks.programAffiliateId, participationIds))
    .orderBy(desc(referralLinks.createdAt), desc(referralLinks.id))
    .limit(PORTAL_LINKS_LIMIT)
}

export interface PortalCommissionFilters {
  /** Effective statuses — a matured `pending` row is listed as `available`. */
  statuses?: CommissionStatus[]
  programId?: string
  limit?: number
  offset?: number
}

/**
 * The affiliate's commissions with the portal's filters. Same shape and joins
 * as `listCommissionsForAffiliate` (customers is a left join: affiliates cannot
 * read the workspace's customers), plus status and program filters.
 */
export async function listPortalCommissions(
  tx: DbClient,
  participationIds: string[],
  { statuses, programId, limit = 25, offset = 0 }: PortalCommissionFilters = {},
): Promise<{ rows: AffiliateCommissionRow[]; total: number }> {
  if (participationIds.length === 0) return { rows: [], total: 0 }

  const where = and(
    inArray(commissions.programAffiliateId, participationIds),
    statuses?.length ? inArray(effectiveCommissionStatusSql(), statuses) : undefined,
    programId ? eq(commissions.programId, programId) : undefined,
  )

  const [totals] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(commissions)
    .where(where)

  const rows = await tx
    .select({
      id: commissions.id,
      programName: programs.name,
      programEnvironment: programs.environment,
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
    .orderBy(desc(commissions.createdAt), desc(commissions.id))
    .limit(limit)
    .offset(offset)

  return { rows, total: totals?.value ?? 0 }
}
