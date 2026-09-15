import type Stripe from "stripe"
import { z } from "zod"

import type { PlanCode } from "@/lib/plans"

import type {
  PlatformEventAction,
  PlatformPrices,
  PlatformSubscriptionStatus,
  PlatformSubscriptionUpdate,
} from "./types"

/**
 * Pure translation from Stripe objects (API 2026-08-26.dahlia) to the
 * provider-free platform-billing shapes. No I/O, no environment: prices are an
 * argument, so every mapping is unit-testable.
 */

/** Events the platform-billing endpoint acts on (docs/PLANS.md §5). */
export const PLATFORM_BILLING_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
] as const

const STATUS_MAP: Record<string, PlatformSubscriptionStatus> = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  unpaid: "past_due",
  canceled: "cancelled",
  incomplete: "incomplete",
  incomplete_expired: "incomplete",
  // Stripe pauses a subscription whose trial ended without a payment method:
  // nothing is being paid, so it follows the past-due path (grace, then
  // restricted) and Settings asks for a payment method.
  paused: "past_due",
}

export function mapStripeSubscriptionStatus(status: string): PlatformSubscriptionStatus {
  // An unknown future status grants nothing.
  return STATUS_MAP[status] ?? "incomplete"
}

export function planForPrice(prices: PlatformPrices, priceId: string | null): PlanCode | null {
  if (!priceId) return null
  if (priceId === prices.launch) return "launch"
  if (priceId === prices.growth) return "growth"
  return null
}

const workspaceIdSchema = z.uuid()

/** A workspace id from Stripe metadata or `client_reference_id`, when well formed. */
export function workspaceIdFrom(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const parsed = workspaceIdSchema.safeParse(candidate)
    if (parsed.success) return parsed.data
  }
  return null
}

function seconds(value: number | null | undefined): Date | null {
  return typeof value === "number" ? new Date(value * 1000) : null
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null
  return typeof value === "string" ? value : value.id
}

/**
 * The item that decides the plan: the one on a known price, else the first.
 * Since API 2025-03-31 (basil) the billing period lives on items, not on the
 * subscription.
 */
function planItem(subscription: Stripe.Subscription, prices: PlatformPrices): Stripe.SubscriptionItem | null {
  const items = subscription.items?.data ?? []
  return items.find((item) => planForPrice(prices, item.price?.id ?? null) !== null) ?? items[0] ?? null
}

export function normalizeSubscription(
  subscription: Stripe.Subscription,
  prices: PlatformPrices,
  eventCreatedAt: Date,
): PlatformSubscriptionUpdate {
  const item = planItem(subscription, prices)
  const priceId = item?.price?.id ?? null
  const status = mapStripeSubscriptionStatus(subscription.status)

  return {
    workspaceId: workspaceIdFrom(subscription.metadata?.workspace_id),
    providerCustomerId: idOf(subscription.customer) ?? "",
    providerSubscriptionId: subscription.id,
    priceId,
    plan: planForPrice(prices, priceId),
    status,
    currentPeriodStart: seconds(item?.current_period_start),
    currentPeriodEnd: seconds(item?.current_period_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    trialStart: seconds(subscription.trial_start),
    trialEnd: seconds(subscription.trial_end),
    cancelledAt: status === "cancelled" ? (seconds(subscription.ended_at) ?? seconds(subscription.canceled_at)) : null,
    eventCreatedAt,
  }
}

function subscriptionOfInvoice(invoice: Stripe.Invoice): {
  subscription: string | Stripe.Subscription | null
  metadata: Stripe.Metadata | null
} {
  const details = invoice.parent?.subscription_details ?? null
  return { subscription: details?.subscription ?? null, metadata: details?.metadata ?? null }
}

/** Decides what a verified event means for a workspace's subscription. */
export function interpretPlatformEvent(event: Stripe.Event, prices: PlatformPrices): PlatformEventAction {
  const createdAt = new Date(event.created * 1000)

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object
      if (session.mode !== "subscription") return { kind: "ignore", reason: "checkout session is not a subscription" }
      const subscription = session.subscription
      if (!subscription) return { kind: "ignore", reason: "checkout session without a subscription" }
      const workspaceId = workspaceIdFrom(session.client_reference_id, session.metadata?.workspace_id)
      if (typeof subscription !== "string") {
        const update = normalizeSubscription(subscription, prices, createdAt)
        return { kind: "apply", update: { ...update, workspaceId: update.workspaceId ?? workspaceId } }
      }
      return { kind: "sync", subscriptionId: subscription, workspaceId, providerCustomerId: idOf(session.customer) }
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return { kind: "apply", update: normalizeSubscription(event.data.object, prices, createdAt) }

    case "invoice.paid":
    case "invoice.payment_failed": {
      const invoice = event.data.object
      const { subscription, metadata } = subscriptionOfInvoice(invoice)
      if (!subscription) return { kind: "ignore", reason: "invoice is not for a subscription" }
      return {
        kind: "sync",
        subscriptionId: idOf(subscription)!,
        workspaceId: workspaceIdFrom(metadata?.workspace_id),
        providerCustomerId: idOf(invoice.customer),
      }
    }

    default:
      return { kind: "ignore", reason: `unhandled type ${event.type}` }
  }
}
