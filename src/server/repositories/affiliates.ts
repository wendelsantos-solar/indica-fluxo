import "server-only"

import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm"

import { type DbClient } from "@/server/db"
import { qualified } from "@/server/db/qualify"
import {
  affiliates,
  commissions,
  programAffiliates,
  programs,
  referralClicks,
  referralLinks,
  transactions,
} from "@/server/db/schema"
import type { ParticipationRules } from "@/server/domain/types"

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
  clicks: number
  customers: number
  revenueMinor: number
  commissionMinor: number
  joinedAt: Date
}

export interface AffiliateListParams {
  workspaceId: string
  programId?: string
  search?: string
  status?: "pending" | "approved" | "rejected" | "suspended"
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
  const { workspaceId, programId, search, status, limit = 25, offset = 0 } = params

  const filters: SQL[] = [eq(affiliates.workspaceId, workspaceId)]
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
      joinedAt: affiliates.createdAt,
      clicks: sql<number>`coalesce((
        select count(*)::int from ${referralClicks}
         where ${referralClicks.programAffiliateId} = ${programAffiliates.id}), 0)`,
      customers: sql<number>`coalesce((
        select count(distinct ${commissions.customerId})::int from ${commissions}
         where ${commissions.programAffiliateId} = ${programAffiliates.id}
           and ${commissions.commissionAmountMinor} > 0), 0)`,
      revenueMinor: sql<number>`coalesce((
        select sum(${commissions.baseAmountMinor})::bigint from ${commissions}
         where ${commissions.programAffiliateId} = ${programAffiliates.id}
           and ${commissions.status} <> 'rejected'), 0)::int`,
      commissionMinor: sql<number>`coalesce((
        select sum(${commissions.commissionAmountMinor})::bigint from ${commissions}
         where ${commissions.programAffiliateId} = ${programAffiliates.id}
           and ${commissions.status} <> 'rejected'), 0)::int`,
    })
    .from(affiliates)
    .leftJoin(programAffiliates, eq(programAffiliates.affiliateId, affiliates.id))
    .leftJoin(programs, eq(programs.id, programAffiliates.programId))
    .where(where)
    .orderBy(desc(affiliates.createdAt))
    .limit(limit)
    .offset(offset)

  const [totals] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(affiliates)
    .leftJoin(programAffiliates, eq(programAffiliates.affiliateId, affiliates.id))
    .where(where)

  return { rows, total: totals?.value ?? 0 }
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

/** Every participation belonging to the signed-in affiliate, with its program. */
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

/** Aggregate KPIs for one participation — the affiliate portal home. */
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
        select sum(${transactions.grossAmountMinor})::bigint from ${commissions}
          join ${transactions} on ${qualified(transactions.id)} = ${qualified(commissions.transactionId)}
         where ${commissions.programAffiliateId} = ${participationId}
           and ${commissions.commissionAmountMinor} > 0), 0)::int`,
      commissionMinor: sql<number>`coalesce((
        select sum(${commissions.commissionAmountMinor})::bigint from ${commissions}
         where ${commissions.programAffiliateId} = ${participationId}
           and ${commissions.status} <> 'rejected'), 0)::int`,
      paidMinor: sql<number>`coalesce((
        select sum(${commissions.commissionAmountMinor})::bigint from ${commissions}
         where ${commissions.programAffiliateId} = ${participationId}
           and ${commissions.status} = 'paid'), 0)::int`,
      pendingMinor: sql<number>`coalesce((
        select sum(${commissions.commissionAmountMinor})::bigint from ${commissions}
         where ${commissions.programAffiliateId} = ${participationId}
           and ${commissions.status} in ('pending','available','approved')), 0)::int`,
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
