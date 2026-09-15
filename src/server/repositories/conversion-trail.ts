import "server-only"

import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"

import { type DbClient } from "@/server/db"
import { qualified } from "@/server/db/qualify"
import {
  affiliates,
  attributions,
  commissions,
  customers,
  payoutBatches,
  payoutItemCommissions,
  payoutItems,
  programAffiliates,
  programs,
  referralClicks,
  referralLinks,
  transactions,
} from "@/server/db/schema"
import { effectiveCommissionStatusSql, type CommissionStatus } from "@/server/repositories/commissions"

/**
 * The read model behind a conversion's path, click to commission.
 *
 * A "conversion" in the founder's lists is a commission row (`listConversions`
 * selects `commissions.id`); a refund's reversal row is one too. The path is
 * drawn for the commission's customer under its affiliate's participation: the
 * attribution that bound them, its first and last click, every payment and
 * refund of that customer, and every commission and reversal they produced.
 *
 * Everything runs as the reader under RLS (`withUser`). A workspace member can
 * read each table involved — `referral_clicks` and `attributions` through the
 * program's workspace, `customers`, `transactions`, `commissions` and
 * `payout_batches` through `is_workspace_member`, `payout_items` and
 * `payout_item_commissions` through the batch's workspace (migrations 0001,
 * 0003) — so nothing is left out for lack of a policy. What the path cannot show
 * is what is not stored: the time of the identify call.
 */

/** Bounds, so a customer with years of renewals cannot turn a page into a dump. */
export const TRAIL_TRANSACTION_LIMIT = 120
export const TRAIL_COMMISSION_LIMIT = 240

export interface TrailClick {
  id: string
  occurredAt: Date
  /** The participation the click came through — not always the credited one. */
  participationId: string
  affiliateId: string
  affiliateName: string
  code: string
  linkCode: string | null
  linkName: string | null
  landingUrl: string
  referrerUrl: string | null
  utm: {
    source: string | null
    medium: string | null
    campaign: string | null
    content: string | null
    term: string | null
  }
}

export interface TrailAttribution {
  id: string
  participationId: string
  model: "first_click" | "last_click"
  attributedAt: Date
  expiresAt: Date
  customerExternalId: string | null
  providerCustomerId: string | null
  firstClickId: string | null
  lastClickId: string | null
}

export interface TrailTransaction {
  id: string
  type: "payment" | "refund" | "chargeback" | "adjustment"
  status: "succeeded" | "pending" | "failed"
  currency: string
  grossAmountMinor: number
  occurredAt: Date
  providerTransactionId: string
}

export interface TrailBatch {
  id: string
  reference: string
  periodEnd: Date
  status: "draft" | "approved" | "paid" | "cancelled"
}

export interface TrailCommission {
  id: string
  transactionId: string
  currency: string
  baseAmountMinor: number
  commissionRate: number | null
  commissionAmountMinor: number
  /** Effective: a matured `pending` reads as `available`. */
  status: CommissionStatus
  eligibleAt: Date
  createdAt: Date
  paidAt: Date | null
  reversedAt: Date | null
  reversalOfCommissionId: string | null
  ruleApplied: string | null
  /** The live (or, failing that, latest) payout batch holding the commission. */
  batch: TrailBatch | null
}

export interface ConversionTrailData {
  /** The commission the page was opened for; may be a reversal row. */
  conversionId: string
  /** The positive commission the reversal (if any) points at. */
  rootCommissionId: string
  rootTransactionId: string
  affiliate: { id: string; name: string; participationId: string; code: string }
  program: {
    id: string
    name: string
    slug: string
    /** Test or live: the trail opens in either, and says which. */
    environment: "test" | "live"
    attributionModel: "first_click" | "last_click"
    attributionWindowDays: number
  }
  customer: {
    id: string
    ref: string
    externalId: string | null
    providerCustomerId: string | null
    createdAt: Date
  }
  attribution: TrailAttribution | null
  clicks: TrailClick[]
  transactions: TrailTransaction[]
  commissions: TrailCommission[]
}

export async function getConversionTrail(
  tx: DbClient,
  workspaceId: string,
  conversionId: string,
): Promise<ConversionTrailData | null> {
  const [opened] = await tx
    .select({ id: commissions.id, reversalOf: commissions.reversalOfCommissionId })
    .from(commissions)
    .where(and(eq(commissions.id, conversionId), eq(commissions.workspaceId, workspaceId)))
    .limit(1)
  if (!opened) return null

  const rootId = opened.reversalOf ?? opened.id

  const [root] = await tx
    .select({
      id: commissions.id,
      transactionId: commissions.transactionId,
      participationId: commissions.programAffiliateId,
      code: programAffiliates.code,
      affiliateId: affiliates.id,
      affiliateName: affiliates.name,
      programId: programs.id,
      programName: programs.name,
      programSlug: programs.slug,
      programEnvironment: programs.environment,
      attributionModel: programs.attributionModel,
      attributionWindowDays: programs.attributionWindowDays,
      customerId: customers.id,
      customerRef: sql<string>`coalesce(${customers.externalId}, ${customers.providerCustomerId}, left(${customers.id}::text, 8))`,
      customerExternalId: customers.externalId,
      providerCustomerId: customers.providerCustomerId,
      customerCreatedAt: customers.createdAt,
    })
    .from(commissions)
    .innerJoin(programAffiliates, eq(programAffiliates.id, commissions.programAffiliateId))
    .innerJoin(affiliates, eq(affiliates.id, programAffiliates.affiliateId))
    .innerJoin(programs, eq(programs.id, commissions.programId))
    .innerJoin(customers, eq(customers.id, commissions.customerId))
    .where(and(eq(commissions.id, rootId), eq(commissions.workspaceId, workspaceId)))
    .limit(1)
  if (!root) return null

  const attribution = await findAttribution(tx, {
    programId: root.programId,
    participationId: root.participationId,
    externalId: root.customerExternalId,
    providerCustomerId: root.providerCustomerId,
  })

  const clickIds = [attribution?.firstClickId, attribution?.lastClickId].filter(
    (id): id is string => typeof id === "string",
  )
  const clicks = clickIds.length > 0 ? await findClicks(tx, root.programId, [...new Set(clickIds)]) : []

  // The customer's money, minus payments another participation was credited
  // for (a customer can convert in two programs of the same workspace).
  const transactionRows = await tx
    .select({
      id: transactions.id,
      type: transactions.type,
      status: transactions.status,
      currency: transactions.currency,
      grossAmountMinor: transactions.grossAmountMinor,
      occurredAt: transactions.occurredAt,
      providerTransactionId: transactions.providerTransactionId,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.workspaceId, workspaceId),
        eq(transactions.customerId, root.customerId),
        sql`not exists (
          select 1 from ${commissions} other_commission
           where other_commission.transaction_id = ${qualified(transactions.id)}
             and other_commission.program_affiliate_id <> ${root.participationId})`,
      ),
    )
    .orderBy(asc(transactions.occurredAt), asc(transactions.id))
    .limit(TRAIL_TRANSACTION_LIMIT)

  const commissionRows = await tx
    .select({
      id: commissions.id,
      transactionId: commissions.transactionId,
      currency: commissions.currency,
      baseAmountMinor: commissions.baseAmountMinor,
      commissionRate: commissions.commissionRate,
      commissionAmountMinor: commissions.commissionAmountMinor,
      status: effectiveCommissionStatusSql(),
      eligibleAt: commissions.eligibleAt,
      createdAt: commissions.createdAt,
      paidAt: commissions.paidAt,
      reversedAt: commissions.reversedAt,
      reversalOfCommissionId: commissions.reversalOfCommissionId,
      ruleApplied: commissions.ruleApplied,
    })
    .from(commissions)
    .where(
      and(
        eq(commissions.workspaceId, workspaceId),
        eq(commissions.customerId, root.customerId),
        eq(commissions.programAffiliateId, root.participationId),
      ),
    )
    .orderBy(asc(commissions.createdAt), asc(commissions.id))
    .limit(TRAIL_COMMISSION_LIMIT)

  const batches = await findBatches(
    tx,
    commissionRows.map((row) => row.id),
  )

  return {
    conversionId: opened.id,
    rootCommissionId: root.id,
    rootTransactionId: root.transactionId,
    affiliate: {
      id: root.affiliateId,
      name: root.affiliateName,
      participationId: root.participationId,
      code: root.code,
    },
    program: {
      id: root.programId,
      name: root.programName,
      slug: root.programSlug,
      environment: root.programEnvironment,
      attributionModel: root.attributionModel,
      attributionWindowDays: root.attributionWindowDays,
    },
    customer: {
      id: root.customerId,
      ref: root.customerRef,
      externalId: root.customerExternalId,
      providerCustomerId: root.providerCustomerId,
      createdAt: root.customerCreatedAt,
    },
    attribution,
    clicks,
    transactions: transactionRows.map((row) => ({ ...row, currency: row.currency.trim() })),
    commissions: commissionRows.map((row) => ({
      ...row,
      currency: row.currency.trim(),
      batch: batches.get(row.id) ?? null,
    })),
  }
}

/**
 * The attribution that binds this customer in this program, found the way the
 * billing webhook finds it (by external or provider customer id). One that
 * credits the commission's own participation wins; otherwise the latest — the
 * row is updated in place, so a later click may have moved it since.
 */
async function findAttribution(
  tx: DbClient,
  params: {
    programId: string
    participationId: string
    externalId: string | null
    providerCustomerId: string | null
  },
): Promise<TrailAttribution | null> {
  const matches: SQL[] = []
  if (params.externalId) matches.push(eq(attributions.customerExternalId, params.externalId))
  if (params.providerCustomerId) matches.push(eq(attributions.providerCustomerId, params.providerCustomerId))
  if (matches.length === 0) return null

  const [row] = await tx
    .select({
      id: attributions.id,
      participationId: attributions.programAffiliateId,
      model: attributions.attributionModel,
      attributedAt: attributions.attributedAt,
      expiresAt: attributions.expiresAt,
      customerExternalId: attributions.customerExternalId,
      providerCustomerId: attributions.providerCustomerId,
      firstClickId: attributions.firstClickId,
      lastClickId: attributions.lastClickId,
    })
    .from(attributions)
    .where(and(eq(attributions.programId, params.programId), or(...matches)))
    .orderBy(
      desc(sql`(${attributions.programAffiliateId} = ${params.participationId})`),
      desc(attributions.attributedAt),
    )
    .limit(1)

  return row ?? null
}

async function findClicks(tx: DbClient, programId: string, ids: string[]): Promise<TrailClick[]> {
  const clickAffiliate = alias(affiliates, "click_affiliate")
  const clickParticipation = alias(programAffiliates, "click_participation")
  const rows = await tx
    .select({
      id: referralClicks.id,
      occurredAt: referralClicks.occurredAt,
      participationId: referralClicks.programAffiliateId,
      affiliateId: clickAffiliate.id,
      affiliateName: clickAffiliate.name,
      code: clickParticipation.code,
      linkCode: referralLinks.code,
      linkName: referralLinks.name,
      landingUrl: referralClicks.landingUrl,
      referrerUrl: referralClicks.referrerUrl,
      utmSource: referralClicks.utmSource,
      utmMedium: referralClicks.utmMedium,
      utmCampaign: referralClicks.utmCampaign,
      utmContent: referralClicks.utmContent,
      utmTerm: referralClicks.utmTerm,
    })
    .from(referralClicks)
    .innerJoin(clickParticipation, eq(clickParticipation.id, referralClicks.programAffiliateId))
    .innerJoin(clickAffiliate, eq(clickAffiliate.id, clickParticipation.affiliateId))
    .leftJoin(referralLinks, eq(referralLinks.id, referralClicks.referralLinkId))
    .where(and(eq(referralClicks.programId, programId), inArray(referralClicks.id, ids)))
    .limit(ids.length)

  return rows.map(({ utmSource, utmMedium, utmCampaign, utmContent, utmTerm, ...row }) => ({
    ...row,
    utm: { source: utmSource, medium: utmMedium, campaign: utmCampaign, content: utmContent, term: utmTerm },
  }))
}

/** Per commission, the batch that holds it: a live one before a cancelled one, newest first. */
async function findBatches(tx: DbClient, commissionIds: string[]): Promise<Map<string, TrailBatch>> {
  const result = new Map<string, TrailBatch>()
  if (commissionIds.length === 0) return result

  const rows = await tx
    .select({
      commissionId: payoutItemCommissions.commissionId,
      id: payoutBatches.id,
      reference: payoutBatches.reference,
      periodEnd: payoutBatches.periodEnd,
      status: payoutBatches.status,
    })
    .from(payoutItemCommissions)
    .innerJoin(payoutItems, eq(payoutItems.id, payoutItemCommissions.payoutItemId))
    .innerJoin(payoutBatches, eq(payoutBatches.id, payoutItems.payoutBatchId))
    .where(inArray(payoutItemCommissions.commissionId, commissionIds))
    .orderBy(
      asc(payoutItemCommissions.commissionId),
      desc(sql`(${payoutItems.status} <> 'cancelled')`),
      desc(payoutItems.createdAt),
    )

  for (const row of rows) {
    if (!result.has(row.commissionId)) {
      const { commissionId, ...batch } = row
      result.set(commissionId, batch)
    }
  }
  return result
}
