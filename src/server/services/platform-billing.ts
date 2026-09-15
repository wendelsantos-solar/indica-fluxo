import "server-only"

import { platformBillingEnv } from "@/lib/env/server"
import { logger } from "@/lib/logger"
import { PLAN_OFFERS, type PlanCode } from "@/lib/plans"
import { platformBillingGateway } from "@/lib/platform-billing/stripe/gateway"
import type {
  PlatformBillingEvent,
  PlatformBillingGateway,
  PlatformSubscriptionUpdate,
  PurchasablePlatformPlan,
} from "@/lib/platform-billing/stripe/types"
import { db, withUser, type DbClient } from "@/server/db"
import type { Entitlements, PlatformSubscriptionStatus, Standing } from "@/server/domain/entitlements"
import { AppError, ConflictError } from "@/server/policies/errors"
import { atLeast, requireMembership, type WorkspaceRole } from "@/server/policies/workspace"
import {
  findBillingAccount,
  findWorkspaceByStripeRefs,
  lockWorkspaceSubscription,
  saveWorkspaceSubscription,
  type LockedWorkspaceSubscription,
} from "@/server/repositories/platform-billing"
import { findWorkspaceSubscription } from "@/server/repositories/plans"
import { claimWebhookEvent, markWebhookEvent } from "@/server/repositories/webhook-events"

import { getWorkspaceEntitlements } from "./entitlements"

/**
 * IndicaFluxo charging workspaces for Launch/Growth — docs/PLANS.md §5–§6.
 * Completely separate from customer billing (`billing-events.ts`), which reads
 * the founders' own Stripe. Stripe itself stays behind
 * `PlatformBillingGateway`; nothing here sees a Stripe type.
 */

/** Stripe subscription states that still hold (or may regain) the plan. */
const LIVE_STATUSES: ReadonlySet<PlatformSubscriptionStatus> = new Set(["active", "trialing", "past_due"])

export class BillingNotConfiguredError extends AppError {
  constructor() {
    super("Platform billing is not configured.", "billing_not_configured", 503, "billing.notConfigured")
  }
}

function isPurchasable(plan: PlanCode): plan is PurchasablePlatformPlan {
  return PLAN_OFFERS[plan].purchasable && (plan === "launch" || plan === "growth")
}

function requireGateway(gateway: PlatformBillingGateway | null | undefined): PlatformBillingGateway {
  const resolved = gateway === undefined ? platformBillingGateway() : gateway
  if (!resolved) throw new BillingNotConfiguredError()
  return resolved
}

// ---------------------------------------------------------------------------
// Webhook ingest
// ---------------------------------------------------------------------------

export type PlatformIngestResult =
  | { status: "duplicate" }
  | { status: "ignored" }
  | { status: "processed" }
  | { status: "failed" }

export interface PlatformIngestDeps {
  /** Defaults to the service connection. Tests pass a transaction they roll back. */
  client?: DbClient
  /** Defaults to the configured Stripe gateway (`null` when not configured). */
  gateway?: PlatformBillingGateway | null
}

type Outcome = { status: "processed"; detail: Record<string, unknown> } | { status: "ignored"; reason: string }

/** A processing failure whose message is safe to store on the claim row. */
class PlatformEventFailure extends Error {}

/**
 * Everything after signature verification for `/api/platform-billing/stripe/webhook`:
 *   1. claim (platform_billing, stripe, event id) — a duplicate is a no-op,
 *      a previously FAILED event is claimed again so Stripe's retry retries
 *   2. resolve the subscription (from the event, or fetched from Stripe)
 *   3. upsert `workspace_subscriptions` in one transaction
 *   4. record how the claim ended
 *
 * Runs on the service connection `db`, bypassing RLS: the caller is Stripe,
 * authenticated by `PLATFORM_STRIPE_WEBHOOK_SECRET`, not a user, and
 * `workspace_subscriptions` is deliberately not writable by `indica_app`
 * (migration 0010) — a workspace member must never be able to grant itself a
 * plan. ARCHITECTURE.md §2 lists this path.
 */
export async function ingestPlatformBillingEvent(
  event: PlatformBillingEvent,
  deps: PlatformIngestDeps = {},
): Promise<PlatformIngestResult> {
  const client = deps.client ?? db
  const log = logger.child({ provider: "stripe", scope: "platform_billing", eventId: event.providerEventId })

  // `workspace_id` stays null on platform events: `latest_webhook_event()` does
  // not filter by scope, and a platform event would otherwise show up as the
  // founder's own "last Stripe event" on Integrations.
  const claim = await claimWebhookEvent(client, {
    scope: "platform_billing",
    provider: "stripe",
    providerEventId: event.providerEventId,
    eventType: event.eventType,
    payloadHash: event.payloadHash,
    workspaceId: null,
    environment: event.environment,
  })
  if (!claim.claimed || !claim.id) {
    log.info("duplicate platform billing webhook ignored", { type: event.eventType })
    return { status: "duplicate" }
  }

  try {
    const outcome = await processPlatformEvent(client, event, deps.gateway)
    if (outcome.status === "ignored") {
      await markWebhookEvent(client, claim.id, "ignored", outcome.reason)
      log.info("platform billing webhook ignored", { type: event.eventType, reason: outcome.reason })
      return { status: "ignored" }
    }
    await markWebhookEvent(client, claim.id, "processed")
    log.info("platform billing webhook processed", { type: event.eventType, ...outcome.detail })
    return { status: "processed" }
  } catch (error) {
    const message =
      error instanceof PlatformEventFailure ? error.message : "processing error; see application logs"
    await markWebhookEvent(client, claim.id, "failed", message)
    log.error("platform billing webhook failed", { type: event.eventType, error })
    return { status: "failed" }
  }
}

async function processPlatformEvent(
  client: DbClient,
  event: PlatformBillingEvent,
  gatewayOverride: PlatformBillingGateway | null | undefined,
): Promise<Outcome> {
  const { action } = event
  if (action.kind === "ignore") return { status: "ignored", reason: action.reason }

  let update: PlatformSubscriptionUpdate
  if (action.kind === "apply") {
    update = action.update
  } else {
    const gateway = gatewayOverride === undefined ? platformBillingGateway() : gatewayOverride
    if (!gateway) {
      // Without the API key the subscription cannot be fetched; the
      // `customer.subscription.*` events carry the same state in full.
      return { status: "ignored", reason: "platform Stripe key not configured; cannot fetch subscription" }
    }
    // Network I/O before any transaction: no connection is held while Stripe answers.
    const fetched = await gateway.retrieveSubscription(action.subscriptionId, event.createdAt)
    update = {
      ...fetched,
      workspaceId: fetched.workspaceId ?? action.workspaceId,
      providerCustomerId: fetched.providerCustomerId || action.providerCustomerId || "",
    }
  }

  if (update.plan === null) {
    throw new PlatformEventFailure(
      `unknown price ${update.priceId ?? "(none)"} on subscription ${update.providerSubscriptionId}: ` +
        "it matches neither STRIPE_LAUNCH_PRICE_ID nor STRIPE_GROWTH_PRICE_ID",
    )
  }
  if (!update.providerCustomerId) {
    throw new PlatformEventFailure(`subscription ${update.providerSubscriptionId} has no customer`)
  }

  return client.transaction(async (tx) => {
    const workspaceId =
      update.workspaceId ??
      (await findWorkspaceByStripeRefs(tx, {
        subscriptionId: update.providerSubscriptionId,
        customerId: update.providerCustomerId,
      }))
    if (!workspaceId) {
      throw new PlatformEventFailure(
        `no workspace for subscription ${update.providerSubscriptionId}: no workspace_id metadata and no known customer`,
      )
    }

    const existing = await lockWorkspaceSubscription(tx, workspaceId)
    const skip = shouldSkip(existing, update)
    if (skip) {
      if (skip.alarm) logger.error("workspace has two live Stripe subscriptions", { workspaceId, ...skip.alarm })
      return { status: "ignored", reason: skip.reason }
    }

    await saveWorkspaceSubscription(tx, existing?.id ?? null, subscriptionValues(workspaceId, existing, update))

    return {
      status: "processed",
      detail: {
        workspaceId,
        from: existing ? { plan: existing.plan, status: existing.status } : null,
        to: { plan: update.plan, status: update.status },
      },
    }
  })
}

function shouldSkip(
  existing: LockedWorkspaceSubscription | null,
  update: PlatformSubscriptionUpdate,
): { reason: string; alarm?: Record<string, unknown> } | null {
  if (!existing) return null

  // Stripe does not deliver in order. Equal seconds apply: checkout and
  // subscription.created routinely share a timestamp.
  if (existing.providerEventAt && update.eventCreatedAt.getTime() < existing.providerEventAt.getTime()) {
    return { reason: "older than the state already applied" }
  }

  const tracksAnother =
    existing.provider === "stripe" &&
    existing.providerSubscriptionId !== null &&
    existing.providerSubscriptionId !== update.providerSubscriptionId &&
    LIVE_STATUSES.has(existing.status)
  if (tracksAnother) {
    // A late event for a replaced subscription must not end the current one.
    // Two live subscriptions at once means double billing: someone must look.
    return {
      reason: "workspace tracks another live subscription",
      alarm: LIVE_STATUSES.has(update.status)
        ? { tracked: existing.providerSubscriptionId, ignored: update.providerSubscriptionId }
        : undefined,
    }
  }
  return null
}

function subscriptionValues(
  workspaceId: string,
  existing: LockedWorkspaceSubscription | null,
  update: PlatformSubscriptionUpdate,
) {
  const sameSubscription = existing?.providerSubscriptionId === update.providerSubscriptionId
  const pastDueSince =
    update.status === "past_due"
      ? sameSubscription && existing?.status === "past_due" && existing.pastDueSince
        ? existing.pastDueSince
        : update.eventCreatedAt
      : null
  const cancelledAt =
    update.status === "cancelled"
      ? (update.cancelledAt ?? (sameSubscription ? existing?.cancelledAt : null) ?? update.eventCreatedAt)
      : null

  return {
    workspaceId,
    plan: update.plan!,
    status: update.status,
    provider: "stripe" as const,
    providerCustomerId: update.providerCustomerId,
    providerSubscriptionId: update.providerSubscriptionId,
    providerPriceId: update.priceId,
    currentPeriodStart: update.currentPeriodStart,
    currentPeriodEnd: update.currentPeriodEnd,
    cancelAtPeriodEnd: update.cancelAtPeriodEnd,
    trialStartedAt: update.trialStart,
    trialEndsAt: update.trialEnd,
    pastDueSince,
    cancelledAt,
    providerEventAt: update.eventCreatedAt,
  }
}

// ---------------------------------------------------------------------------
// Checkout and Billing Portal (owners and admins)
// ---------------------------------------------------------------------------

export interface CheckoutOptions {
  locale: string
  /** The signed-in user's e-mail, pre-filled for a workspace without a Stripe customer. */
  customerEmail: string | null
  successUrl: string
  cancelUrl: string
}

/**
 * A Stripe Checkout session (subscription mode, no trial) for `plan`. The
 * redirect back is not trusted: the webhook writes the subscription.
 * A workspace already paying through Stripe changes plan in the portal instead.
 */
export async function createCheckoutSession(
  userId: string,
  workspaceId: string,
  plan: PlanCode,
  options: CheckoutOptions,
  deps: { gateway?: PlatformBillingGateway | null } = {},
): Promise<{ url: string }> {
  const gateway = requireGateway(deps.gateway)
  if (!isPurchasable(plan)) throw new ConflictError(`Plan ${plan} cannot be bought.`, "billing.planNotPurchasable")

  const account = await withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")
    return findBillingAccount(tx, workspaceId)
  })

  const stripeAccount = account?.provider === "stripe" ? account : null
  if (stripeAccount?.providerSubscriptionId && LIVE_STATUSES.has(stripeAccount.status)) {
    throw new ConflictError("The workspace already has a subscription; use the billing portal.", "billing.alreadySubscribed")
  }

  const customerId = stripeAccount?.providerCustomerId ?? null
  const session = await gateway.createCheckoutSession({
    workspaceId,
    priceId: gateway.prices[plan],
    customerId,
    customerEmail: customerId ? null : options.customerEmail,
    locale: options.locale,
    successUrl: options.successUrl,
    cancelUrl: options.cancelUrl,
  })
  logger.info("platform checkout started", { workspaceId, plan })
  return session
}

/**
 * A Stripe Billing Portal session: card, invoices, cancellation. With `change`,
 * opens straight on confirming a switch of the subscription's single item to
 * that plan's price (Launch ↔ Growth).
 */
export async function createBillingPortalSession(
  userId: string,
  workspaceId: string,
  returnUrl: string,
  change?: { plan: PlanCode },
  options: { locale?: string; gateway?: PlatformBillingGateway | null } = {},
): Promise<{ url: string }> {
  const gateway = requireGateway(options.gateway)

  const account = await withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")
    return findBillingAccount(tx, workspaceId)
  })
  if (account?.provider !== "stripe" || !account.providerCustomerId) {
    throw new ConflictError("The workspace has no Stripe customer yet.", "billing.noBillingAccount")
  }

  let portalChange: { subscriptionId: string; priceId: string } | undefined
  if (change) {
    if (!isPurchasable(change.plan)) {
      throw new ConflictError(`Plan ${change.plan} cannot be bought.`, "billing.planNotPurchasable")
    }
    if (!account.providerSubscriptionId || !LIVE_STATUSES.has(account.status)) {
      throw new ConflictError("There is no subscription to change.", "billing.noActiveSubscription")
    }
    if (account.plan === change.plan) {
      throw new ConflictError("The subscription is already on this plan.", "billing.planUnchanged")
    }
    portalChange = { subscriptionId: account.providerSubscriptionId, priceId: gateway.prices[change.plan] }
  }

  return gateway.createPortalSession({
    customerId: account.providerCustomerId,
    returnUrl,
    locale: options.locale ?? "auto",
    change: portalChange,
  })
}

// ---------------------------------------------------------------------------
// Settings read model
// ---------------------------------------------------------------------------

export interface BillingOverview {
  /** All four platform-billing variables are set: Checkout and portal are available. */
  configured: boolean
  plan: PlanCode
  subscribedPlan: PlanCode
  status: Entitlements["status"]
  standing: Standing
  /** Monthly price of the subscribed plan; `0` for Sandbox, `null` when not priced. */
  priceMonthlyMinor: number | null
  currency: "BRL"
  /** Next charge date: the period end of a subscription that renews. */
  currentPeriodEnd: Date | null
  /** Set when the subscription will not renew. */
  endsAt: Date | null
  graceEndsAt: Date | null
  trialEndsAt: Date | null
  provider: "stripe" | "paddle" | "manual" | null
  /** A Stripe customer exists, so the Billing Portal can open. */
  canManageBilling: boolean
  /** The viewer is owner or admin: may start checkout or open the portal. */
  viewerCanManage: boolean
}

/** Plan and billing state for Settings → Plano e cobrança. Any member may read it. */
export async function getBillingOverview(userId: string, workspaceId: string): Promise<BillingOverview> {
  const configured = platformBillingEnv() !== null

  return withUser(userId, async (tx) => {
    const role: WorkspaceRole = await requireMembership(tx, workspaceId, userId)
    const [entitlements, subscription] = await Promise.all([
      getWorkspaceEntitlements(tx, workspaceId),
      findWorkspaceSubscription(tx, workspaceId),
    ])
    const offer = PLAN_OFFERS[entitlements.subscribedPlan]
    const paying = entitlements.standing !== "sandbox"

    return {
      configured,
      plan: entitlements.plan,
      subscribedPlan: entitlements.subscribedPlan,
      status: entitlements.status,
      standing: entitlements.standing,
      priceMonthlyMinor: offer.priceMonthlyMinor,
      currency: offer.currency,
      currentPeriodEnd:
        paying && subscription && !subscription.cancelAtPeriodEnd ? subscription.currentPeriodEnd : null,
      endsAt: entitlements.endsAt,
      graceEndsAt: entitlements.graceEndsAt,
      trialEndsAt: subscription?.status === "trialing" ? subscription.trialEndsAt : null,
      provider: subscription?.provider ?? null,
      canManageBilling: subscription?.provider === "stripe" && subscription.hasBillingCustomer,
      viewerCanManage: atLeast(role, "admin"),
    }
  })
}
