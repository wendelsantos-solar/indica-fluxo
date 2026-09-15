import Stripe from "stripe"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const SECRET = "whsec_platform_billing_secret_0123456789"
const WORKSPACE_ID = "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"

const mocks = vi.hoisted(() => ({
  platformBillingEnv: vi.fn(),
  ingestPlatformBillingEvent: vi.fn(),
}))

vi.mock("@/lib/env/server", () => ({ platformBillingEnv: mocks.platformBillingEnv }))
vi.mock("@/server/services/platform-billing", () => ({
  ingestPlatformBillingEvent: mocks.ingestPlatformBillingEvent,
}))
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

const { POST } = await import("../route")

const body = JSON.stringify({
  id: "evt_platform_1",
  object: "event",
  type: "customer.subscription.updated",
  created: 1_790_000_000,
  livemode: true,
  data: {
    object: {
      id: "sub_1",
      object: "subscription",
      customer: "cus_1",
      status: "active",
      cancel_at_period_end: false,
      metadata: { workspace_id: WORKSPACE_ID },
      items: { data: [{ id: "si_1", price: { id: "price_growth" }, current_period_start: 1, current_period_end: 2 }] },
    },
  },
})

function call(secret: string | null) {
  const headers = new Headers({ "content-type": "application/json" })
  if (secret) {
    headers.set("stripe-signature", Stripe.webhooks.generateTestHeaderString({ payload: body, secret }))
  }
  return POST(new NextRequest("http://localhost/api/platform-billing/stripe/webhook", { method: "POST", headers, body }))
}

describe("POST /api/platform-billing/stripe/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.platformBillingEnv.mockReturnValue({
      secretKey: "sk_test_x",
      webhookSecret: SECRET,
      launchPriceId: "price_launch",
      growthPriceId: "price_growth",
    })
    mocks.ingestPlatformBillingEvent.mockResolvedValue({ status: "processed" })
  })

  it("accepts a delivery signed with the platform secret and hands over a provider-free event", async () => {
    const response = await call(SECRET)

    expect(response.status).toBe(200)
    expect(mocks.ingestPlatformBillingEvent).toHaveBeenCalledTimes(1)
    const [event] = mocks.ingestPlatformBillingEvent.mock.calls[0]!
    expect(event).toMatchObject({
      providerEventId: "evt_platform_1",
      eventType: "customer.subscription.updated",
      environment: "live",
      action: { kind: "apply", update: { plan: "growth", workspaceId: WORKSPACE_ID } },
    })
    expect(event.payloadHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("rejects a signature made with another secret and ingests nothing", async () => {
    const response = await call("whsec_some_founder_endpoint_000000")

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "invalid_signature" })
    expect(mocks.ingestPlatformBillingEvent).not.toHaveBeenCalled()
  })

  it("rejects a delivery without a signature", async () => {
    const response = await call(null)
    expect(response.status).toBe(400)
    expect(mocks.ingestPlatformBillingEvent).not.toHaveBeenCalled()
  })

  it("answers 500 when processing failed, so Stripe retries", async () => {
    mocks.ingestPlatformBillingEvent.mockResolvedValue({ status: "failed" })
    const response = await call(SECRET)
    expect(response.status).toBe(500)
  })

  it("acknowledges a duplicate with 200", async () => {
    mocks.ingestPlatformBillingEvent.mockResolvedValue({ status: "duplicate" })
    const response = await call(SECRET)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true, duplicate: true })
  })

  it("answers 503 when platform billing is not configured", async () => {
    mocks.platformBillingEnv.mockReturnValue(null)
    const response = await call(SECRET)
    expect(response.status).toBe(503)
    expect(mocks.ingestPlatformBillingEvent).not.toHaveBeenCalled()
  })
})
