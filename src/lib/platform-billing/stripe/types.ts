import type { PlanCode } from "@/lib/plans"

/**
 * Provider-free shapes for IndicaFluxo's own billing (docs/PLANS.md §5).
 * Services depend on these, never on Stripe's types: everything Stripe-shaped
 * stays inside `src/lib/platform-billing/stripe/`.
 */

export type PlatformSubscriptionStatus = "trialing" | "active" | "past_due" | "cancelled" | "incomplete"

/** The Prices that can be bought, from `STRIPE_LAUNCH_PRICE_ID` / `STRIPE_GROWTH_PRICE_ID`. */
export interface PlatformPrices {
  launch: string
  growth: string
}

export type PurchasablePlatformPlan = keyof PlatformPrices

/** A Stripe subscription, as the `workspace_subscriptions` row needs it. */
export interface PlatformSubscriptionUpdate {
  /** From `metadata.workspace_id` (set at checkout); `null` when absent or malformed. */
  workspaceId: string | null
  providerCustomerId: string
  providerSubscriptionId: string
  priceId: string | null
  /** `null` when the price is not one of `PlatformPrices` — never guessed. */
  plan: PlanCode | null
  status: PlatformSubscriptionStatus
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  trialStart: Date | null
  trialEnd: Date | null
  cancelledAt: Date | null
  /** `created` of the event that carried (or triggered a fetch of) this state. */
  eventCreatedAt: Date
}

/** What one verified webhook asks the service to do. */
export type PlatformEventAction =
  /** The event carries the subscription object itself. */
  | { kind: "apply"; update: PlatformSubscriptionUpdate }
  /** The event only names a subscription: fetch it from Stripe, then apply. */
  | {
      kind: "sync"
      subscriptionId: string
      workspaceId: string | null
      providerCustomerId: string | null
    }
  | { kind: "ignore"; reason: string }

export interface PlatformBillingEvent {
  providerEventId: string
  eventType: string
  createdAt: Date
  environment: "test" | "live"
  /** SHA-256 of the raw body, for `webhook_events.payload_hash`. */
  payloadHash: string
  action: PlatformEventAction
}

export interface PlatformCheckoutInput {
  workspaceId: string
  priceId: string
  /** Reused when the workspace already has a Stripe customer. */
  customerId: string | null
  /** Pre-fills Checkout for a new customer. */
  customerEmail: string | null
  locale: string
  successUrl: string
  cancelUrl: string
}

export interface PlatformPortalInput {
  customerId: string
  returnUrl: string
  locale: string
  /** Opens the portal on "confirm this plan change" for the subscription's single item. */
  change?: { subscriptionId: string; priceId: string }
}

/** The Stripe API calls platform billing makes. Injected so tests never reach Stripe. */
export interface PlatformBillingGateway {
  prices: PlatformPrices
  retrieveSubscription(subscriptionId: string, eventCreatedAt: Date): Promise<PlatformSubscriptionUpdate>
  createCheckoutSession(input: PlatformCheckoutInput): Promise<{ url: string }>
  createPortalSession(input: PlatformPortalInput): Promise<{ url: string }>
}
