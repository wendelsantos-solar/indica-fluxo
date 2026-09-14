import "./bootstrap"
import "server-only"

import type { NormalizedBillingEvent } from "@/lib/billing/types"
import { createFormatters } from "@/lib/money"
import { slugify } from "@/lib/utils"
import { db } from "@/server/db"
import {
  affiliates,
  integrations,
  programAffiliates,
  programs,
  referralClicks,
  referralLinks,
  workspaceMembers,
  workspaces,
} from "@/server/db/schema"
import { promoteEligibleCommissions } from "@/server/repositories/commissions"
import { createApiKeyPair } from "@/server/services/api-keys"
import { handleBillingEvent } from "@/server/services/billing-events"
import { identifyCustomer } from "@/server/services/identify"
import { createPayoutBatch, markBatchPaid } from "@/server/services/payouts"
import { recordClick } from "@/server/services/tracking"

import { assertNotProduction, describeTarget } from "./bootstrap"
import { ensureUser } from "./auth"
import {
  COUNTRIES,
  DEMO_AFFILIATES,
  DEMO_FOUNDER,
  DEMO_PASSWORD,
  DEMO_PROGRAM,
  DEMO_STRIPE_ACCOUNT,
  DEMO_WORKSPACE,
  SEED_LOCALE,
  HISTORY_DAYS,
  USER_AGENTS,
  UTM_MEDIUMS,
  UTM_SOURCES,
  daysAgo,
  pick,
  rng,
  type AffiliateBlueprint,
} from "./blueprint"
import { resetDemo } from "./reset"

/**
 * Builds the demo workspace by driving the *real* code paths — `recordClick`,
 * `identifyCustomer`, `handleBillingEvent`, `createPayoutBatch` — rather than
 * writing ledger rows by hand.
 *
 * That matters: a seed that inserts its own commissions would drift from the
 * engine and quietly hide the bugs it should expose. Here, every commission in
 * the demo database was produced by the same code that will process a live
 * Stripe webhook.
 *
 * Runs on the service connection, which bypasses RLS. This is one of the three
 * documented service-role call sites (ARCHITECTURE.md §2); `assertNotProduction`
 * keeps it away from anything that is not a development database.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
const random = rng(20260914)

interface Seeded {
  workspaceId: string
  founderUserId: string
  programId: string
  participants: {
    blueprint: AffiliateBlueprint
    participationId: string
    affiliateId: string
  }[]
}

async function createWorkspace(): Promise<Seeded> {
  const founderUserId = await ensureUser(DEMO_FOUNDER.email, DEMO_FOUNDER.fullName)

  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: DEMO_WORKSPACE.name,
      slug: DEMO_WORKSPACE.slug,
      defaultCurrency: DEMO_WORKSPACE.currency,
      timezone: DEMO_WORKSPACE.timezone,
    })
    .returning({ id: workspaces.id })

  const workspaceId = workspace!.id

  await db.insert(workspaceMembers).values({ workspaceId, userId: founderUserId, role: "owner" })

  const [program] = await db
    .insert(programs)
    // The demo SaaS "lives" on the app origin, which is also where named links
    // point, so the default referral link and named links agree.
    .values({ workspaceId, ...DEMO_PROGRAM, websiteUrl: APP_URL })
    .returning({ id: programs.id })

  const programId = program!.id

  // A connected billing account, so the integrations page is not an empty state
  // and `workspaceForProviderAccount` can route demo events.
  await db.insert(integrations).values({
    workspaceId,
    provider: "stripe",
    providerAccountId: DEMO_STRIPE_ACCOUNT,
    status: "connected",
    metadata: { demo: true, livemode: false },
    connectedAt: daysAgo(HISTORY_DAYS + 5),
  })

  const participants: Seeded["participants"] = []

  for (const blueprint of DEMO_AFFILIATES) {
    const userId = blueprint.withLogin ? await ensureUser(blueprint.email, blueprint.name) : null

    const [affiliate] = await db
      .insert(affiliates)
      .values({
        workspaceId,
        userId,
        email: blueprint.email,
        name: blueprint.name,
        companyName: blueprint.companyName,
        country: blueprint.country,
        status: userId ? "active" : "invited",
      })
      .returning({ id: affiliates.id })

    const approved = blueprint.participationStatus === "approved"

    const [participation] = await db
      .insert(programAffiliates)
      .values({
        programId,
        affiliateId: affiliate!.id,
        code: blueprint.code,
        status: blueprint.participationStatus,
        customCommissionType: blueprint.customCommissionValue ? "percentage" : null,
        customCommissionValue: blueprint.customCommissionValue ?? null,
        approvedAt: approved ? daysAgo(HISTORY_DAYS) : null,
      })
      .returning({ id: programAffiliates.id })

    if (blueprint.links.length > 0) {
      await db.insert(referralLinks).values(
        blueprint.links.map((link) => ({
          programAffiliateId: participation!.id,
          name: link.name,
          destinationUrl: `${APP_URL}${link.path}`,
          // A link code is unique per participation, so it derives from the
          // link name — exactly as `createReferralLink` does. The affiliate's
          // own `blueprint.code` lives on program_affiliates and would collide
          // for any affiliate with more than one link.
          code: slugify(link.name),
          campaign: link.campaign,
        })),
      )
    }

    participants.push({
      blueprint,
      participationId: participation!.id,
      affiliateId: affiliate!.id,
    })
  }

  return { workspaceId, founderUserId, programId, participants }
}

/**
 * Traffic that never converts. Inserted in bulk rather than through
 * `recordClick`: these visitors produce no attribution, so there is no domain
 * decision to exercise — only volume for the funnel and the charts.
 */
async function seedNoiseClicks(seeded: Seeded): Promise<number> {
  const rows: (typeof referralClicks.$inferInsert)[] = []

  for (const participant of seeded.participants) {
    for (let i = 0; i < participant.blueprint.noiseClicks; i += 1) {
      const day = Math.floor(random() * HISTORY_DAYS)
      rows.push({
        programId: seeded.programId,
        programAffiliateId: participant.participationId,
        visitorId: `noise_${participant.blueprint.code}_${i}`,
        landingUrl: `${APP_URL}/?ref=${participant.blueprint.code}`,
        referrerUrl: pick(random, [
          "https://news.ycombinator.com/",
          "https://www.google.com/",
          "https://x.com/",
          null,
        ]),
        utmSource: pick(random, UTM_SOURCES),
        utmMedium: pick(random, UTM_MEDIUMS),
        utmCampaign: participant.blueprint.links[0]?.campaign ?? null,
        country: pick(random, COUNTRIES),
        deviceType: pick(random, ["desktop", "mobile", "tablet"] as const),
        occurredAt: daysAgo(day, Math.floor(random() * 9)),
      })
    }
  }

  for (let start = 0; start < rows.length; start += 500) {
    await db.insert(referralClicks).values(rows.slice(start, start + 500))
  }

  return rows.length
}

interface Conversion {
  participationId: string
  code: string
  index: number
  visitorId: string
  externalId: string
  providerCustomerId: string
  providerSubscriptionId: string
  planMinor: number
  clickDay: number
  signupDay: number
  /** Still on trial: a subscription, but no payment yet. */
  trialOnly: boolean
  cancelled: boolean
  refundSecondPayment: boolean
}

function planConversions(seeded: Seeded): Conversion[] {
  const conversions: Conversion[] = []

  for (const participant of seeded.participants) {
    const { blueprint } = participant

    for (let i = 0; i < blueprint.conversions; i += 1) {
      // Spread signups across the history so the revenue chart has a shape.
      const clickDay = Math.max(2, HISTORY_DAYS - 8 - i * 14 - Math.floor(random() * 6))
      const signupDay = Math.max(1, clickDay - 1 - Math.floor(random() * 4))

      conversions.push({
        participationId: participant.participationId,
        code: blueprint.code,
        index: i,
        visitorId: `visitor_${blueprint.code}_${i}`,
        externalId: `user_${blueprint.code}_${i}`,
        providerCustomerId: `cus_demo_${blueprint.code}_${i}`,
        providerSubscriptionId: `sub_demo_${blueprint.code}_${i}`,
        planMinor: blueprint.plans[i % blueprint.plans.length]!,
        clickDay,
        signupDay,
        trialOnly: signupDay < 10,
        cancelled: blueprint.code === "joao" && i === 1,
        refundSecondPayment: blueprint.code === "wendel" && i === 2,
      })
    }
  }

  return conversions
}

/** Click → attribution, through the real tracking service. */
async function seedConvertingTraffic(seeded: Seeded, conversions: Conversion[]): Promise<void> {
  for (const conversion of conversions) {
    await recordClick({
      workspaceId: seeded.workspaceId,
      code: conversion.code,
      visitorId: conversion.visitorId,
      landingUrl: `${APP_URL}/?ref=${conversion.code}`,
      referrerUrl: pick(random, ["https://x.com/", "https://www.google.com/", null]),
      utm: {
        utm_source: pick(random, UTM_SOURCES),
        utm_medium: pick(random, UTM_MEDIUMS),
      },
      userAgent: pick(random, USER_AGENTS),
      country: pick(random, COUNTRIES),
      occurredAt: daysAgo(conversion.clickDay),
    })

    // A second visit before signing up — exercises the last-click refresh path.
    if (random() > 0.6 && conversion.clickDay > conversion.signupDay) {
      await recordClick({
        workspaceId: seeded.workspaceId,
        code: conversion.code,
        visitorId: conversion.visitorId,
        landingUrl: `${APP_URL}/pricing?ref=${conversion.code}`,
        userAgent: pick(random, USER_AGENTS),
        occurredAt: daysAgo(conversion.signupDay),
      })
    }

    // Server-side identify: binds the anonymous visitor to a known customer.
    await identifyCustomer({
      workspaceId: seeded.workspaceId,
      visitorId: conversion.visitorId,
      externalId: conversion.externalId,
      providerCustomerId: conversion.providerCustomerId,
      provider: "stripe",
      email: `${conversion.externalId}@example.com`,
    })
  }
}

function subscriptionEvent(
  conversion: Conversion,
  status: "trialing" | "active",
  at: Date,
): NormalizedBillingEvent {
  return {
    type: "subscription.updated",
    provider: "stripe",
    providerEventId: `evt_demo_sub_${conversion.code}_${conversion.index}_${status}`,
    rawType: "customer.subscription.updated",
    occurredAt: at,
    providerAccountId: DEMO_STRIPE_ACCOUNT,
    customerEmail: `${conversion.externalId}@example.com`,
    subscription: {
      providerSubscriptionId: conversion.providerSubscriptionId,
      providerCustomerId: conversion.providerCustomerId,
      status,
      currency: DEMO_PROGRAM.currency,
      amountMinor: conversion.planMinor,
      interval: "month",
      startedAt: at,
      currentPeriodStart: at,
      currentPeriodEnd: new Date(at.getTime() + 30 * 24 * 3600 * 1000),
      cancelledAt: null,
    },
  }
}

/**
 * Replays a customer's billing history as normalised events. Every payment goes
 * through `handleBillingEvent`, so the commissions below are the engine's own
 * output — including the renewals that fall outside the 60-day attribution
 * window and must still pay (ARCHITECTURE.md §5).
 */
async function seedBilling(seeded: Seeded, conversions: Conversion[]): Promise<number> {
  let payments = 0

  for (const conversion of conversions) {
    const signupAt = daysAgo(conversion.signupDay)

    await handleBillingEvent(
      seeded.workspaceId,
      subscriptionEvent(conversion, conversion.trialOnly ? "trialing" : "active", signupAt),
    )

    if (conversion.trialOnly) continue

    // Monthly renewals from signup until today.
    const chargeDays: number[] = []
    for (let day = conversion.signupDay; day >= 0; day -= 30) chargeDays.push(day)

    for (const [cycle, day] of chargeDays.entries()) {
      const occurredAt = daysAgo(day, 1)
      const chargeId = `ch_demo_${conversion.code}_${conversion.index}_${cycle}`

      await handleBillingEvent(
        seeded.workspaceId,
        {
          type: "payment.succeeded",
          provider: "stripe",
          providerEventId: `evt_demo_pay_${conversion.code}_${conversion.index}_${cycle}`,
          rawType: "invoice.payment_succeeded",
          occurredAt,
          providerAccountId: DEMO_STRIPE_ACCOUNT,
          providerTransactionId: chargeId,
          providerCustomerId: conversion.providerCustomerId,
          providerSubscriptionId: conversion.providerSubscriptionId,
          customerEmail: `${conversion.externalId}@example.com`,
          currency: DEMO_PROGRAM.currency,
          amountMinor: conversion.planMinor,
        },
        occurredAt,
      )
      payments += 1

      // One customer charges back their second month: the ledger must show a
      // reversal row, never a deleted commission (CLAUDE.md rule 9).
      if (conversion.refundSecondPayment && cycle === 1) {
        const refundedAt = daysAgo(day - 3, 2)
        await handleBillingEvent(
          seeded.workspaceId,
          {
            type: "payment.refunded",
            provider: "stripe",
            providerEventId: `evt_demo_refund_${conversion.code}_${conversion.index}_${cycle}`,
            rawType: "charge.refunded",
            occurredAt: refundedAt,
            providerAccountId: DEMO_STRIPE_ACCOUNT,
            providerTransactionId: `re_demo_${conversion.code}_${conversion.index}_${cycle}`,
            providerParentTransactionId: chargeId,
            providerCustomerId: conversion.providerCustomerId,
            currency: DEMO_PROGRAM.currency,
            amountMinor: conversion.planMinor,
            isChargeback: false,
          },
          refundedAt,
        )
      }
    }

    if (conversion.cancelled) {
      const cancelledAt = daysAgo(Math.max(0, conversion.signupDay - 90))
      await handleBillingEvent(seeded.workspaceId, {
        type: "subscription.cancelled",
        provider: "stripe",
        providerEventId: `evt_demo_cancel_${conversion.code}_${conversion.index}`,
        rawType: "customer.subscription.deleted",
        occurredAt: cancelledAt,
        providerAccountId: DEMO_STRIPE_ACCOUNT,
        providerSubscriptionId: conversion.providerSubscriptionId,
        providerCustomerId: conversion.providerCustomerId,
        cancelledAt,
      })
    }
  }

  return payments
}

/**
 * One settled payout, so the payouts page has history rather than a single
 * empty state. Goes through the real service, which means it also runs under
 * RLS as the founder and writes the audit log.
 */
async function seedPayout(seeded: Seeded): Promise<string | null> {
  await promoteEligibleCommissions(db, seeded.workspaceId)

  // Pay the two smaller affiliates and leave the rest outstanding, so the
  // dashboard shows both "paid" history and an "available to pay" balance.
  const participationIds = seeded.participants
    .filter((p) => ["joao", "maria"].includes(p.blueprint.code))
    .map((p) => p.participationId)

  try {
    const batch = await createPayoutBatch(seeded.founderUserId, seeded.workspaceId, {
      currency: DEMO_PROGRAM.currency,
      participationIds,
      periodStart: daysAgo(60),
      periodEnd: daysAgo(30),
      notes: "Paid by bank transfer.",
    })

    await markBatchPaid(
      seeded.founderUserId,
      seeded.workspaceId,
      batch.id,
      "WISE-DEMO-48213",
    )

    const f = createFormatters(SEED_LOCALE)
    return `${batch.reference} — ${f.money(batch.totalAmountMinor, DEMO_PROGRAM.currency)}`
  } catch (error) {
    // Nothing payable yet is a legitimate outcome, not a seed failure.
    console.warn(`  payout skipped: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

async function main() {
  assertNotProduction("pnpm db:seed")

  console.log(`Seeding the demo workspace on ${describeTarget()} …`)

  await resetDemo()
  const seeded = await createWorkspace()
  console.log(`  workspace  ${DEMO_WORKSPACE.name} (/${DEMO_WORKSPACE.slug})`)

  const keys = await createApiKeyPair(db, seeded.workspaceId, seeded.founderUserId)

  const noise = await seedNoiseClicks(seeded)
  const conversions = planConversions(seeded)
  await seedConvertingTraffic(seeded, conversions)
  console.log(`  traffic    ${noise + conversions.length} clicks, ${conversions.length} identified`)

  const payments = await seedBilling(seeded, conversions)
  console.log(`  billing    ${payments} payments replayed through the webhook handler`)

  const payout = await seedPayout(seeded)
  if (payout) console.log(`  payout     ${payout}`)

  console.log("\nDone. Sign in at /login with:\n")
  console.log(`  founder    ${DEMO_FOUNDER.email}`)
  for (const affiliate of DEMO_AFFILIATES.filter((a) => a.withLogin)) {
    console.log(`  affiliate  ${affiliate.email}`)
  }
  console.log(`  password   ${DEMO_PASSWORD}\n`)

  console.log("Demo API keys (shown once, exactly as the product does):")
  for (const key of keys) {
    console.log(`  ${key.type.padEnd(12)} ${key.plaintext}`)
  }

  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
