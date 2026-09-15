import "server-only"

import { and, desc, eq, ne, sql } from "drizzle-orm"

import { hashIp } from "@/lib/crypto/hash"
import { logger } from "@/lib/logger"
import { classifyDevice, sanitizeUrl, type DeviceType } from "@/lib/tracking/visitor"
import { db, type DbClient, type Transaction } from "@/server/db"
import { attributions, programAffiliates, programs, referralClicks, referralLinks } from "@/server/db/schema"
import { resolveAttribution } from "@/server/domain/attribution"
import { NotFoundError } from "@/server/policies/errors"

import { canUseFeature, getWorkspaceEntitlements } from "./entitlements"

export interface RecordClickInput {
  workspaceId: string
  /** From the publishable key: a test key only reaches test programs, a live key live ones. */
  environment: "test" | "live"
  code: string
  /**
   * Narrows the code lookup to one program. Only for in-product callers that
   * already know the program (the sandbox simulation); the tracker never sends it.
   */
  programId?: string
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

export type RecordClickResult =
  | {
      recorded: true
      clickId: string
      programId: string
      programAffiliateId: string
      attributionAction: "create" | "replace" | "touch" | "ignore"
    }
  /** A live key on a workspace without live mode: nothing was written (docs/PLANS.md §2). */
  | { recorded: false; reason: "live_mode_inactive" }

/**
 * Anonymous ingest: the caller has a publishable key, not a session, so this
 * runs on the service connection. It is one of the three documented
 * service-role call sites (ARCHITECTURE.md §2) and writes nothing outside the
 * workspace — and the environment — the key belongs to.
 */
export async function recordClick(
  input: RecordClickInput,
  /** For the database-backed tests and the sandbox tests, which roll everything back. */
  client: Pick<Transaction, "transaction"> = db,
): Promise<RecordClickResult> {
  const occurredAt = input.occurredAt ?? new Date()

  return client.transaction(async (tx) => {
    // Live clicks are processed only with live mode. Checked before anything is
    // read or written, so a lapsed plan records nothing at all.
    if (input.environment === "live" && !(await hasLiveMode(tx, input.workspaceId))) {
      return { recorded: false, reason: "live_mode_inactive" } as const
    }

    const match = await findParticipationByCode(tx, input)
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

    const recorded = {
      recorded: true as const,
      clickId: click!.id,
      programId: match.programId,
      programAffiliateId: match.participationId,
    }

    if (!trackable) return { ...recorded, attributionAction: "ignore" as const }

    // One decision at a time per (program, visitor). The advisory lock covers
    // the first click, when there is no row to lock yet; `FOR UPDATE` covers
    // identify binding the same row concurrently. Without both, two clicks (or
    // a click and an identify) could each decide from the same stale read.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`attribution:${match.programId}:${input.visitorId}`}, 0))`,
    )

    const [current] = await tx
      .select({
        programAffiliateId: attributions.programAffiliateId,
        firstClickId: attributions.firstClickId,
        lastClickId: attributions.lastClickId,
        attributedAt: attributions.attributedAt,
        expiresAt: attributions.expiresAt,
        customerExternalId: attributions.customerExternalId,
        providerCustomerId: attributions.providerCustomerId,
      })
      .from(attributions)
      .where(and(eq(attributions.programId, match.programId), eq(attributions.visitorId, input.visitorId)))
      .limit(1)
      .for("update")

    // Renewal lock: once identify has bound this visitor to a customer, the
    // affiliate that brought them keeps them. Another affiliate's later click
    // (last-click, or after the window) is still recorded, but it must not move
    // the customer's future payments (PLAN_FEATURE_AUDIT A2, attribution). A
    // click from the same affiliate goes through the model as usual.
    const bound = Boolean(current?.customerExternalId || current?.providerCustomerId)
    if (current && bound && current.programAffiliateId !== match.participationId) {
      await tx
        .update(attributions)
        .set({ lastClickId: click!.id, updatedAt: new Date() })
        .where(and(eq(attributions.programId, match.programId), eq(attributions.visitorId, input.visitorId)))

      logger.debug("click recorded on a bound attribution", {
        workspaceId: input.workspaceId,
        programId: match.programId,
      })
      return { ...recorded, programAffiliateId: current.programAffiliateId, attributionAction: "touch" as const }
    }

    const decision = resolveAttribution({
      current: current ?? null,
      click: { clickId: click!.id, programAffiliateId: match.participationId, occurredAt },
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

    return { ...recorded, programAffiliateId: decision.programAffiliateId, attributionAction: decision.action }
  })
}

async function hasLiveMode(tx: DbClient, workspaceId: string): Promise<boolean> {
  const entitlements = await getWorkspaceEntitlements(tx, workspaceId)
  return entitlements.standing !== "restricted" && canUseFeature(entitlements, "liveMode")
}

/**
 * The participation a referral code names, among the programs of the key's
 * workspace and environment. Codes are unique per program, so the same code
 * can exist in two programs; the choice is deterministic — an active program
 * first, then the newest — instead of whatever row Postgres returns first.
 */
async function findParticipationByCode(tx: Transaction, input: RecordClickInput) {
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
      and(
        eq(programs.workspaceId, input.workspaceId),
        eq(programs.environment, input.environment),
        eq(programAffiliates.code, input.code),
        input.programId ? eq(programs.id, input.programId) : undefined,
      ),
    )
    .orderBy(desc(sql`${programs.status} = 'active'`), desc(programs.createdAt), desc(programs.id))
    .limit(1)

  return match ?? null
}

/**
 * Whether `code` is already used by a participation in any program of the same
 * workspace and environment as `programId` (optionally ignoring one
 * participation). A new code should be unique there, not only within its
 * program, so a referral link can never be read as another program's
 * affiliate. Runs on the caller's client, so RLS applies when it is `withUser`.
 */
export async function isReferralCodeTaken(
  tx: DbClient,
  programId: string,
  code: string,
  exceptParticipationId?: string,
): Promise<boolean> {
  const scope = tx
    .select({ workspaceId: programs.workspaceId, environment: programs.environment })
    .from(programs)
    .where(eq(programs.id, programId))
    .as("scope")

  const [taken] = await tx
    .select({ id: programAffiliates.id })
    .from(programAffiliates)
    .innerJoin(programs, eq(programs.id, programAffiliates.programId))
    .innerJoin(scope, and(eq(scope.workspaceId, programs.workspaceId), eq(scope.environment, programs.environment)))
    .where(
      and(
        eq(programAffiliates.code, code),
        exceptParticipationId ? ne(programAffiliates.id, exceptParticipationId) : undefined,
      ),
    )
    .limit(1)

  return Boolean(taken)
}

async function findLinkId(tx: Transaction, participationId: string, landingUrl: string): Promise<string | null> {
  const linkCode = safeParam(landingUrl, "link")
  if (!linkCode) return null

  const [link] = await tx
    .select({ id: referralLinks.id })
    .from(referralLinks)
    .where(and(eq(referralLinks.programAffiliateId, participationId), eq(referralLinks.code, linkCode)))
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
