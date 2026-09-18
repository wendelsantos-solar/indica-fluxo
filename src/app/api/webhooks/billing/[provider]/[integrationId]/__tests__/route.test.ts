import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const INTEGRATION_ID = "5b1e2d3c-4f5a-4b6c-8d7e-9f0a1b2c3d4e"
const WORKSPACE_ID = "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d"
const AUTH_TOKEN = "t".repeat(40)

const services = vi.hoisted(() => ({
  connectionWebhookTarget: vi.fn(),
  noteConnectionAccount: vi.fn(),
  recordConnectionRejection: vi.fn(),
  ingestVerifiedWebhook: vi.fn(),
}))

vi.mock("@/server/services/billing-connections", () => services)
vi.mock("@/server/services/billing-events", () => ({ ingestVerifiedWebhook: services.ingestVerifiedWebhook }))
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

const { POST } = await import("../route")
const { asaas, mercadoPago } = await import("@/lib/billing/__fixtures__/providers")
const { mercadoPagoManifest, signMercadoPago } = await import("@/lib/billing/mercado-pago/connector")

function call(provider: string, integrationId: string, body: unknown, headers: Record<string, string> = {}, query = "") {
  const request = new NextRequest(`http://localhost/api/webhooks/billing/${provider}/${integrationId}${query}`, {
    method: "POST",
    headers: new Headers({ "content-type": "application/json", ...headers }),
    body: JSON.stringify(body),
  })
  return POST(request, { params: Promise.resolve({ provider, integrationId }) })
}

describe("POST /api/webhooks/billing/[provider]/[integrationId]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    services.connectionWebhookTarget.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      integrationId: INTEGRATION_ID,
      environment: "test",
      providerAccountId: null,
      credentials: { apiKey: "$aact_hmlg_fixture_0001", authToken: AUTH_TOKEN },
    })
    services.ingestVerifiedWebhook.mockResolvedValue({ status: "processed" })
  })

  it("authenticates with the connection's own token and fixes workspace, connection and environment", async () => {
    const response = await call("asaas", INTEGRATION_ID, asaas.payment("PAYMENT_RECEIVED"), { "asaas-access-token": AUTH_TOKEN })

    expect(response.status).toBe(200)
    expect(services.connectionWebhookTarget).toHaveBeenCalledWith("asaas", INTEGRATION_ID)
    const [args] = services.ingestVerifiedWebhook.mock.calls[0]!
    expect(args).toMatchObject({ workspaceId: WORKSPACE_ID, integrationId: INTEGRATION_ID, connectionEnvironment: "test" })
    expect(args.provider).toEqual({ id: "asaas" })
    const events = await args.normalize()
    expect(events[0]).toMatchObject({ type: "payment.succeeded", environment: "test", amountMinor: 14990 })
  })

  it("rejects a wrong token, records the rejection and ingests nothing", async () => {
    const response = await call("asaas", INTEGRATION_ID, asaas.payment("PAYMENT_RECEIVED"), { "asaas-access-token": "x".repeat(40) })
    expect(response.status).toBe(401)
    expect(services.recordConnectionRejection).toHaveBeenCalledWith(INTEGRATION_ID)
    expect(services.ingestVerifiedWebhook).not.toHaveBeenCalled()
  })

  it("answers an unknown connection, an unknown provider and Stripe with the same bare 404", async () => {
    services.connectionWebhookTarget.mockResolvedValue(null)
    for (const provider of ["asaas", "paypal", "stripe"]) {
      const response = await call(provider, INTEGRATION_ID, {})
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: "not_found" })
    }
    expect((await call("asaas", "not-a-uuid", {})).status).toBe(404)
  })

  it("learns a Mercado Pago account once, and refuses another account on the same connection", async () => {
    const secret = "mp-webhook-secret-fixture"
    const notification = mercadoPago.notification("1000000001")
    const ts = "1757000000"
    const signature = signMercadoPago(mercadoPagoManifest("1000000001", "req-1", ts), secret)
    const headers = { "x-signature": `ts=${ts},v1=${signature}`, "x-request-id": "req-1" }
    services.connectionWebhookTarget.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      integrationId: INTEGRATION_ID,
      environment: "live",
      providerAccountId: null,
      credentials: { accessToken: "APP_USR-fixture-token-0001", webhookSecret: secret },
    })

    const first = await call("mercado_pago", INTEGRATION_ID, notification, headers, "?data.id=1000000001&type=payment")
    expect(first.status).toBe(200)
    expect(services.noteConnectionAccount).toHaveBeenCalledWith(INTEGRATION_ID, "44444444")

    services.connectionWebhookTarget.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      integrationId: INTEGRATION_ID,
      environment: "live",
      providerAccountId: "55555555",
      credentials: { accessToken: "APP_USR-fixture-token-0001", webhookSecret: secret },
    })
    const other = await call("mercado_pago", INTEGRATION_ID, notification, headers, "?data.id=1000000001&type=payment")
    expect(other.status).toBe(200)
    expect(await other.json()).toEqual({ received: true, ignored: "account_mismatch" })
    expect(services.ingestVerifiedWebhook).toHaveBeenCalledTimes(1)
  })

  it("never answers 410, which would switch an AbacatePay webhook off", async () => {
    services.connectionWebhookTarget.mockResolvedValue(null)
    expect((await call("abacatepay", INTEGRATION_ID, {})).status).not.toBe(410)
    services.ingestVerifiedWebhook.mockResolvedValue({ status: "failed" })
    services.connectionWebhookTarget.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      integrationId: INTEGRATION_ID,
      environment: "live",
      providerAccountId: null,
      credentials: { apiKey: "abc_prod_fixture_0001", webhookSecret: "a".repeat(43) },
    })
    expect((await call("abacatepay", INTEGRATION_ID, {}, {}, "?webhookSecret=wrong")).status).not.toBe(410)
  })
})
