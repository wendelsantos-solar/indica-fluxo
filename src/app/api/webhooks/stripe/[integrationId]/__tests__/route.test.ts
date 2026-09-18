import Stripe from "stripe"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const INTEGRATION_ID = "3f2a9c1b-7d4e-4a8b-9c0d-1e2f3a4b5c6d"
const WORKSPACE_ID = "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"
const SECRET = "whsec_workspace_secret_0123456789"

const services = vi.hoisted(() => ({
  webhookTargetForIntegration: vi.fn(),
  recordWebhookRejection: vi.fn(),
  ingestVerifiedWebhook: vi.fn(),
}))

vi.mock("@/server/services/integrations", () => ({
  webhookTargetForIntegration: services.webhookTargetForIntegration,
  recordWebhookRejection: services.recordWebhookRejection,
}))
vi.mock("@/server/services/billing-events", () => ({
  ingestVerifiedWebhook: services.ingestVerifiedWebhook,
}))
vi.mock("@/lib/billing/provider", () => ({
  billingProvider: () => ({ id: "stripe", normalizeEvent: () => null }),
}))
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

const { POST } = await import("../route")

const body = JSON.stringify({
  id: "evt_route_1",
  object: "event",
  livemode: false,
  type: "invoice.paid",
  created: 1_760_000_000,
  // Even a Connect-style account on the event must not decide the workspace.
  account: "acct_someoneElse123",
  data: { object: { id: "in_1", object: "invoice" } },
})

function call(integrationId: string, secret: string | null, payload = body) {
  const headers = new Headers({ "content-type": "application/json" })
  if (secret) {
    headers.set("stripe-signature", Stripe.webhooks.generateTestHeaderString({ payload, secret }))
  }
  const request = new NextRequest(`http://localhost/api/webhooks/stripe/${integrationId}`, {
    method: "POST",
    headers,
    body: payload,
  })
  return POST(request, { params: Promise.resolve({ integrationId }) })
}

describe("POST /api/webhooks/stripe/[integrationId]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    services.webhookTargetForIntegration.mockResolvedValue({ workspaceId: WORKSPACE_ID, secrets: { test: SECRET, live: null } })
    services.ingestVerifiedWebhook.mockResolvedValue({ status: "processed" })
  })

  it("verifies with the integration's secret and fixes the workspace to the integration's", async () => {
    const response = await call(INTEGRATION_ID, SECRET)

    expect(response.status).toBe(200)
    expect(services.webhookTargetForIntegration).toHaveBeenCalledWith(INTEGRATION_ID)
    expect(services.ingestVerifiedWebhook).toHaveBeenCalledTimes(1)
    const [args] = services.ingestVerifiedWebhook.mock.calls[0]!
    expect(args.workspaceId).toBe(WORKSPACE_ID)
    expect(args.verified.providerEventId).toBe("evt_route_1")
    expect(args.rawBody).toBe(body)
  })

  it("rejects a signature made with another secret, records the rejection, ingests nothing", async () => {
    const response = await call(INTEGRATION_ID, "whsec_platform_or_other_endpoint_000")

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "invalid_signature" })
    expect(services.recordWebhookRejection).toHaveBeenCalledWith(INTEGRATION_ID)
    expect(services.ingestVerifiedWebhook).not.toHaveBeenCalled()
  })

  it("does not record a rejection for a live delivery when no live secret is saved yet", async () => {
    const liveBody = body.replace('"livemode":false', '"livemode":true')
    const response = await call(INTEGRATION_ID, "whsec_live_endpoint_not_saved_yet_0", liveBody)

    // Still non-2xx, so Stripe retries and the retries land once the secret is saved.
    expect(response.status).toBe(400)
    expect(services.recordWebhookRejection).not.toHaveBeenCalled()
    expect(services.ingestVerifiedWebhook).not.toHaveBeenCalled()
  })

  it("answers 404 without detail for an unknown integration or one with no secret", async () => {
    services.webhookTargetForIntegration.mockResolvedValue(null)
    const response = await call(INTEGRATION_ID, SECRET)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "not_found" })
    expect(services.ingestVerifiedWebhook).not.toHaveBeenCalled()
  })

  it("answers 404 for an id that is not a uuid, before touching the database", async () => {
    const response = await call("not-a-uuid", SECRET)

    expect(response.status).toBe(404)
    expect(services.webhookTargetForIntegration).not.toHaveBeenCalled()
  })

  it("rejects a test-mode event signed with the live endpoint's secret", async () => {
    services.webhookTargetForIntegration.mockResolvedValue({ workspaceId: WORKSPACE_ID, secrets: { test: null, live: SECRET } })
    const response = await call(INTEGRATION_ID, SECRET)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "livemode_mismatch" })
    expect(services.ingestVerifiedWebhook).not.toHaveBeenCalled()
  })

  it("acknowledges a live event without live mode as ignored, so Stripe stops retrying", async () => {
    services.ingestVerifiedWebhook.mockResolvedValue({ status: "ignored", reason: "live_mode_inactive" })
    const response = await call(INTEGRATION_ID, SECRET)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true, ignored: "live_mode_inactive" })
  })

  it("requires the signature header", async () => {
    const response = await call(INTEGRATION_ID, null)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "missing_signature" })
  })

  it("asks Stripe to retry when processing fails", async () => {
    services.ingestVerifiedWebhook.mockResolvedValue({ status: "failed" })
    const response = await call(INTEGRATION_ID, SECRET)

    expect(response.status).toBe(500)
  })
})
