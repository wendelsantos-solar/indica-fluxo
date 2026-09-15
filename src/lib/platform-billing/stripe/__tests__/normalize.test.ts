import type Stripe from "stripe"
import { describe, expect, it } from "vitest"

import {
  interpretPlatformEvent,
  mapStripeSubscriptionStatus,
  normalizeSubscription,
  planForPrice,
} from "../normalize"

const PRICES = { launch: "price_launch", growth: "price_growth" }
const WORKSPACE_ID = "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"
const CREATED = 1_790_000_000
const AT = new Date(CREATED * 1000)

function subscription(overrides: Record<string, unknown> = {}, items?: unknown[]): Stripe.Subscription {
  return {
    id: "sub_1",
    object: "subscription",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: false,
    canceled_at: null,
    ended_at: null,
    trial_start: null,
    trial_end: null,
    metadata: { workspace_id: WORKSPACE_ID },
    items: {
      object: "list",
      data: items ?? [
        { id: "si_1", price: { id: "price_launch" }, current_period_start: 1_789_000_000, current_period_end: 1_791_600_000 },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Subscription
}

function event(type: string, object: unknown): Stripe.Event {
  return { id: "evt_1", object: "event", type, created: CREATED, livemode: false, data: { object } } as unknown as Stripe.Event
}

describe("mapStripeSubscriptionStatus", () => {
  it.each([
    ["active", "active"],
    ["trialing", "trialing"],
    ["past_due", "past_due"],
    ["unpaid", "past_due"],
    ["paused", "past_due"],
    ["canceled", "cancelled"],
    ["incomplete", "incomplete"],
    ["incomplete_expired", "incomplete"],
    ["something_new", "incomplete"],
  ])("maps %s to %s", (stripeStatus, expected) => {
    expect(mapStripeSubscriptionStatus(stripeStatus)).toBe(expected)
  })
})

describe("planForPrice", () => {
  it("matches only the configured prices", () => {
    expect(planForPrice(PRICES, "price_launch")).toBe("launch")
    expect(planForPrice(PRICES, "price_growth")).toBe("growth")
    expect(planForPrice(PRICES, "price_other")).toBeNull()
    expect(planForPrice(PRICES, null)).toBeNull()
  })
})

describe("normalizeSubscription", () => {
  it("reads the billing period from the subscription item (dahlia)", () => {
    const update = normalizeSubscription(subscription(), PRICES, AT)
    expect(update).toMatchObject({
      workspaceId: WORKSPACE_ID,
      providerCustomerId: "cus_1",
      providerSubscriptionId: "sub_1",
      priceId: "price_launch",
      plan: "launch",
      status: "active",
      currentPeriodStart: new Date(1_789_000_000 * 1000),
      currentPeriodEnd: new Date(1_791_600_000 * 1000),
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      eventCreatedAt: AT,
    })
  })

  it("carries cancel_at_period_end and trial dates", () => {
    const update = normalizeSubscription(
      subscription({ cancel_at_period_end: true, trial_start: 1_788_000_000, trial_end: 1_789_000_000 }),
      PRICES,
      AT,
    )
    expect(update.cancelAtPeriodEnd).toBe(true)
    expect(update.trialStart).toEqual(new Date(1_788_000_000 * 1000))
    expect(update.trialEnd).toEqual(new Date(1_789_000_000 * 1000))
  })

  it("returns plan null for an unknown price instead of guessing", () => {
    const update = normalizeSubscription(
      subscription({}, [{ id: "si_1", price: { id: "price_other" }, current_period_start: 1, current_period_end: 2 }]),
      PRICES,
      AT,
    )
    expect(update.plan).toBeNull()
    expect(update.priceId).toBe("price_other")
  })

  it("picks the item on a known price when there are several", () => {
    const update = normalizeSubscription(
      subscription({}, [
        { id: "si_addon", price: { id: "price_addon" }, current_period_start: 1, current_period_end: 2 },
        { id: "si_plan", price: { id: "price_growth" }, current_period_start: 10, current_period_end: 20 },
      ]),
      PRICES,
      AT,
    )
    expect(update.plan).toBe("growth")
    expect(update.currentPeriodEnd).toEqual(new Date(20_000))
  })

  it("stamps cancelledAt from ended_at on a cancelled subscription", () => {
    const update = normalizeSubscription(
      subscription({ status: "canceled", canceled_at: 1_789_500_000, ended_at: 1_789_600_000 }),
      PRICES,
      AT,
    )
    expect(update.status).toBe("cancelled")
    expect(update.cancelledAt).toEqual(new Date(1_789_600_000 * 1000))
  })

  it("ignores malformed workspace metadata", () => {
    expect(normalizeSubscription(subscription({ metadata: { workspace_id: "acme" } }), PRICES, AT).workspaceId).toBeNull()
  })
})

describe("interpretPlatformEvent", () => {
  it("syncs the subscription named by a completed subscription checkout", () => {
    const action = interpretPlatformEvent(
      event("checkout.session.completed", {
        id: "cs_1",
        mode: "subscription",
        subscription: "sub_1",
        customer: "cus_1",
        client_reference_id: WORKSPACE_ID,
        metadata: {},
      }),
      PRICES,
    )
    expect(action).toEqual({ kind: "sync", subscriptionId: "sub_1", workspaceId: WORKSPACE_ID, providerCustomerId: "cus_1" })
  })

  it("ignores a one-off payment checkout", () => {
    const action = interpretPlatformEvent(event("checkout.session.completed", { mode: "payment", subscription: null }), PRICES)
    expect(action.kind).toBe("ignore")
  })

  it("applies subscription events from the object they carry", () => {
    const action = interpretPlatformEvent(event("customer.subscription.updated", subscription({ status: "past_due" })), PRICES)
    expect(action).toMatchObject({ kind: "apply", update: { status: "past_due", plan: "launch", eventCreatedAt: AT } })
  })

  it("syncs the subscription of a paid or failed invoice (parent.subscription_details)", () => {
    const action = interpretPlatformEvent(
      event("invoice.payment_failed", {
        id: "in_1",
        customer: "cus_1",
        parent: { type: "subscription_details", subscription_details: { subscription: "sub_1", metadata: { workspace_id: WORKSPACE_ID } } },
      }),
      PRICES,
    )
    expect(action).toEqual({ kind: "sync", subscriptionId: "sub_1", workspaceId: WORKSPACE_ID, providerCustomerId: "cus_1" })
  })

  it("ignores an invoice without a subscription and unrelated events", () => {
    expect(interpretPlatformEvent(event("invoice.paid", { id: "in_2", customer: "cus_1", parent: null }), PRICES).kind).toBe("ignore")
    expect(interpretPlatformEvent(event("charge.refunded", { id: "ch_1" }), PRICES).kind).toBe("ignore")
  })
})
