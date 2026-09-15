import Stripe from "stripe"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { verifyStripeWebhook } = await import("../webhook")

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
