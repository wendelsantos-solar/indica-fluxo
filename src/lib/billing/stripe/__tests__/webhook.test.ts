import Stripe from "stripe"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { StripeLivemodeMismatchError, StripeSignatureError, verifyStripeWebhook, verifyStripeWebhookWithSecrets } = await import("../webhook")

const SECRET = "whsec_test_right_secret_0123456789"
const OTHER = "whsec_test_other_secret_9876543210"

const payload = JSON.stringify({
  id: "evt_test_123",
  object: "event",
  type: "invoice.paid",
  created: 1_760_000_000,
  data: { object: { id: "in_test_1", object: "invoice" } },
})

function sign(body: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  return Stripe.webhooks.generateTestHeaderString({ payload: body, secret, timestamp })
}

describe("verifyStripeWebhook (per-integration secret)", () => {
  it("accepts a delivery signed with the integration's own secret", async () => {
    const verified = await verifyStripeWebhook(payload, sign(payload, SECRET), SECRET)
    expect(verified.providerEventId).toBe("evt_test_123")
    expect(verified.rawType).toBe("invoice.paid")
    // A founder's own endpoint carries no Connect account; the workspace comes from the URL.
    expect(verified.providerAccountId).toBeNull()
  })

  it("rejects a delivery signed with a different endpoint's secret", async () => {
    await expect(verifyStripeWebhook(payload, sign(payload, OTHER), SECRET)).rejects.toThrow()
  })

  it("rejects a body that was altered after signing", async () => {
    const header = sign(payload, SECRET)
    const tampered = payload.replace("invoice.paid", "charge.refunded")
    await expect(verifyStripeWebhook(tampered, header, SECRET)).rejects.toThrow()
  })

  it("rejects a replay outside the timestamp tolerance", async () => {
    const stale = Math.floor(Date.now() / 1000) - 60 * 60
    await expect(verifyStripeWebhook(payload, sign(payload, SECRET, stale), SECRET)).rejects.toThrow()
  })
})

describe("verifyStripeWebhookWithSecrets (test and live endpoint secrets)", () => {
  const TEST_SECRET = "whsec_test_endpoint_0123456789"
  const LIVE_SECRET = "whsec_live_endpoint_0123456789"
  const body = (livemode: boolean) =>
    JSON.stringify({ id: "evt_env", object: "event", type: "invoice.paid", created: 1_760_000_000, livemode, data: { object: { id: "in_1" } } })

  it("accepts a test event signed by the test endpoint's secret", async () => {
    const raw = body(false)
    const verified = await verifyStripeWebhookWithSecrets(raw, sign(raw, TEST_SECRET), { test: TEST_SECRET, live: LIVE_SECRET })
    expect(verified.environment).toBe("test")
  })

  it("accepts a live event signed by the live endpoint's secret", async () => {
    const raw = body(true)
    const verified = await verifyStripeWebhookWithSecrets(raw, sign(raw, LIVE_SECRET), { test: TEST_SECRET, live: LIVE_SECRET })
    expect(verified.environment).toBe("live")
  })

  it("works with only one of the two secrets saved", async () => {
    const raw = body(false)
    const verified = await verifyStripeWebhookWithSecrets(raw, sign(raw, TEST_SECRET), { test: TEST_SECRET, live: null })
    expect(verified.environment).toBe("test")
  })

  it("rejects a test event signed with the live secret, and a live event signed with the test secret", async () => {
    const test = body(false)
    await expect(
      verifyStripeWebhookWithSecrets(test, sign(test, LIVE_SECRET), { test: TEST_SECRET, live: LIVE_SECRET }),
    ).rejects.toBeInstanceOf(StripeLivemodeMismatchError)
    const live = body(true)
    await expect(
      verifyStripeWebhookWithSecrets(live, sign(live, TEST_SECRET), { test: TEST_SECRET, live: LIVE_SECRET }),
    ).rejects.toBeInstanceOf(StripeLivemodeMismatchError)
  })

  it("rejects a signature no saved secret verifies", async () => {
    const raw = body(true)
    await expect(
      verifyStripeWebhookWithSecrets(raw, sign(raw, OTHER), { test: TEST_SECRET, live: LIVE_SECRET }),
    ).rejects.toBeInstanceOf(StripeSignatureError)
  })
})
