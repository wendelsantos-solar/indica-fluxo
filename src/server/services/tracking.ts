import "server-only"

import { and, eq, sql } from "drizzle-orm"

import { hashIp } from "@/lib/crypto/hash"
import { logger } from "@/lib/logger"
import { classifyDevice, sanitizeUrl, type DeviceType } from "@/lib/tracking/visitor"
import { db } from "@/server/db"
import {
  apiKeys,
  attributions,
  programAffiliates,
  programs,
  referralClicks,
  referralLinks,
} from "@/server/db/schema"
import { resolveAttribution } from "@/server/domain/attribution"
import { NotFoundError } from "@/server/policies/errors"

export interface RecordClickInput {
  workspaceId: string
  code: string
  visitorId: string
  landingUrl: string
  referrerUrl?: string | null
  utm?: Partial<
    Record<"utm_source" | "utm_medium" | "utm_campaign" | "utm_content" | "utm_term", string | null>
  >
  userAgent?: string | null
  ip?: string | null
  country?: string | null
  occurredAt?: Date
}

export interface RecordClickResult {
  clickId: string
  programId: string
  programAffiliateId: string
  attributionAction: "create" | "replace" | "touch" | "ignore"
}

/**
 * Anonymous ingest: the caller has a publishable key, not a session, so this
 * runs on the service connection. It is one of the three documented
 * service-role call sites (ARCHITECTURE.md §2) and writes nothing outside the
 * workspace the key belongs to.
 */
export async function recordClick(input: RecordClickInput): Promise<RecordClickResult> {
  const occurredAt = input.occurredAt ?? new Date()

  return db.transaction(async (tx) => {
    const [match] = await tx
      .select({
        participationId: programAffiliates.id,
        programId: programs.id,
        attributionModel: programs.attributionModel,
        attributionWindowDays: programs.attributionWindowDays,
        participationStatus: programAffiliates.status,
        programStatus: programs.status,
      })
      .from(programAffiliates)
      .innerJoin(programs, eq(programs.id, programAffiliates.programId))
      .where(
        and(eq(programs.workspaceId, input.workspaceId), eq(programAffiliates.code, input.code)),
      )
      .limit(1)

    if (!match) throw new NotFoundError("Unknown referral code.", "unknownReferralCode")

    // A paused program still records the click for reporting, but never
    // reassigns attribution — that would silently move money.
    const trackable = match.programStatus === "active" && match.participationStatus === "approved"

    const linkId = await findLinkId(tx, match.participationId, input.landingUrl)

    const [click] = await tx
      .insert(referralClicks)
      .values({
        programId: match.programId,
        programAffiliateId: match.participationId,
        referralLinkId: linkId,
        visitorId: input.visitorId,
        landingUrl: sanitizeUrl(input.landingUrl) ?? input.landingUrl.slice(0, 1000),
        referrerUrl: sanitizeUrl(input.referrerUrl),
        utmSource: input.utm?.utm_source ?? null,
        utmMedium: input.utm?.utm_medium ?? null,
        utmCampaign: input.utm?.utm_campaign ?? null,
        utmContent: input.utm?.utm_content ?? null,
        utmTerm: input.utm?.utm_term ?? null,
        country: input.country?.slice(0, 2).toUpperCase() ?? null,
        deviceType: classifyDevice(input.userAgent) as DeviceType,
        ipHash: input.ip ? hashIp(input.ip) : null,
        occurredAt,
      })
      .returning({ id: referralClicks.id })

    if (!trackable) {
      return {
        clickId: click!.id,
        programId: match.programId,
        programAffiliateId: match.participationId,
        attributionAction: "ignore" as const,
      }
    }

    const [current] = await tx
      .select({
        programAffiliateId: attributions.programAffiliateId,
        firstClickId: attributions.firstClickId,
        lastClickId: attributions.lastClickId,
        attributedAt: attributions.attributedAt,
        expiresAt: attributions.expiresAt,
      })
      .from(attributions)
      .where(
        and(
          eq(attributions.programId, match.programId),
          eq(attributions.visitorId, input.visitorId),
        ),
      )
      .limit(1)

    const decision = resolveAttribution({
      current: current ?? null,
      click: {
        clickId: click!.id,
        programAffiliateId: match.participationId,
        occurredAt,
      },
      model: match.attributionModel,
      windowDays: match.attributionWindowDays,
      now: occurredAt,
    })

    await tx
      .insert(attributions)
      .values({
        programId: match.programId,
        programAffiliateId: decision.programAffiliateId,
        visitorId: input.visitorId,
        firstClickId: decision.firstClickId,
        lastClickId: decision.lastClickId,
        attributionModel: match.attributionModel,
        attributedAt: decision.attributedAt,
        expiresAt: decision.expiresAt,
      })
      .onConflictDoUpdate({
        target: [attributions.programId, attributions.visitorId],
        set: {
          programAffiliateId: decision.programAffiliateId,
          firstClickId: decision.firstClickId,
          lastClickId: decision.lastClickId,
          // The model that made this decision, so the row explains itself even
          // after the program's model is changed.
          attributionModel: match.attributionModel,
          attributedAt: decision.attributedAt,
          expiresAt: decision.expiresAt,
          updatedAt: new Date(),
        },
      })

    logger.debug("click recorded", {
      workspaceId: input.workspaceId,
      programId: match.programId,
      action: decision.action,
      reason: decision.reason,
    })

    return {
      clickId: click!.id,
      programId: match.programId,
      programAffiliateId: decision.programAffiliateId,
      attributionAction: decision.action,
    }
  })
}

async function findLinkId(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  participationId: string,
  landingUrl: string,
): Promise<string | null> {
  const linkCode = safeParam(landingUrl, "link")
  if (!linkCode) return null

  const [link] = await tx
    .select({ id: referralLinks.id })
    .from(referralLinks)
    .where(
      and(
        eq(referralLinks.programAffiliateId, participationId),
        eq(referralLinks.code, linkCode),
      ),
    )
    .limit(1)

  return link?.id ?? null
}

function safeParam(url: string, key: string): string | null {
  try {
    return new URL(url).searchParams.get(key)
  } catch {
    return null
  }
}

/** Resolves a publishable key to its workspace without exposing the hash. */
export async function workspaceForPublishableKey(keyHash: string): Promise<string | null> {
  const [row] = await db
    .select({ workspaceId: apiKeys.workspaceId })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.type, "publishable")))
    .limit(1)
  return row?.workspaceId ?? null
}

/** Refreshes the display-only click counters. Never a source of truth. */
export async function refreshLinkCounters(programId: string): Promise<void> {
  await db.execute(
    sql`
      update referral_links l
         set click_count_cached = sub.total
        from (
          select referral_link_id, count(*)::int as total
            from referral_clicks
           where program_id = ${programId} and referral_link_id is not null
           group by referral_link_id
        ) sub
       where l.id = sub.referral_link_id
    `,
  )
}
