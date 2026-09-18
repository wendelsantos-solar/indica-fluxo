/**
 * The contract every billing connector passes (brief §81). One suite, run per
 * connector against sanitized fixtures: a valid delivery verifies, a forged one
 * does not, redeliveries keep their id, a payment and a refund normalise to the
 * provider-free contract with integer minor units, customers resolve, unknown
 * events yield nothing, and setup refuses a bad credential. A new provider is
 * one more `describeConnector(...)` block.
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { WebhookAuthError, ConnectorSetupError } = await import("@/lib/billing/connector")
const { MercadoPagoConnector, mercadoPagoManifest, signMercadoPago } = await import("@/lib/billing/mercado-pago/connector")
const { AbacatePayConnector, signAbacatePay, ABACATEPAY_EVENTS } = await import("@/lib/billing/abacatepay/connector")
const { AsaasConnector, ASAAS_API } = await import("@/lib/billing/asaas/connector")
const { FIXTURE_TOKEN, abacatePay, asaas, mercadoPago } = await import("@/lib/billing/__fixtures__/providers")

import type { BillingConnector, HttpClient, WebhookDelivery } from "@/lib/billing/connector"
import type { NormalizedBillingEvent } from "@/lib/billing/types"

function delivery(body: unknown, headers: Record<string, string> = {}, query = ""): WebhookDelivery {
  const raw = typeof body === "string" ? body : JSON.stringify(body)
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))
  return { rawBody: raw, header: (name) => lower[name.toLowerCase()] ?? null, query: new URLSearchParams(query) }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

interface Harness {
  connector: BillingConnector
  credentials: Record<string, string>
  environment: "test" | "live" | null
  /** A correctly authenticated delivery of `body`. */
  signed: (body: unknown) => WebhookDelivery
  /** The same body with a forged credential. */
  forged: (body: unknown) => WebhookDelivery
  unauthenticated: (body: unknown) => WebhookDelivery
  payment: unknown
  refund: unknown
  unknown: unknown
  http: HttpClient
  expected: {
    paymentId: string
    amountMinor: number
    currency: string
    customer: string
    refundCumulative: number
    /** When the refund fixture is another payment of the same provider. */
    refundOf?: string
  }
  connectInput: { apiKey: string; webhookSecret?: string }
  badKey: string
}

function describeConnector(name: string, harness: () => Harness) {
  describe(`${name} connector contract`, () => {
    const normalize = async (h: Harness, body: unknown): Promise<NormalizedBillingEvent[]> => {
      const verified = await h.connector.verify(h.signed(body), h.credentials)
      return h.connector.normalize(verified, { credentials: h.credentials, environment: h.environment, http: h.http })
    }

    it("verifies a valid delivery and keeps its id across redeliveries (duplicate)", async () => {
      const h = harness()
      const first = await h.connector.verify(h.signed(h.payment), h.credentials)
      const again = await h.connector.verify(h.signed(h.payment), h.credentials)
      expect(first.providerEventId).toBeTruthy()
      expect(again.providerEventId).toBe(first.providerEventId)
    })

    it("rejects a forged or unauthenticated delivery before parsing it", async () => {
      const h = harness()
      await expect(h.connector.verify(h.forged(h.payment), h.credentials)).rejects.toBeInstanceOf(WebhookAuthError)
      await expect(h.connector.verify(h.unauthenticated(h.payment), h.credentials)).rejects.toBeInstanceOf(WebhookAuthError)
      await expect(h.connector.verify(h.signed(h.payment), { nothing: "here" })).rejects.toBeInstanceOf(WebhookAuthError)
    })

    it("normalises a payment to integer minor units, with its customer and reference", async () => {
      const h = harness()
      const events = await normalize(h, h.payment)
      const payment = events.find((event) => event.type === "payment.succeeded")
      expect(payment).toBeDefined()
      if (payment?.type !== "payment.succeeded") return
      expect(payment.providerTransactionId).toBe(h.expected.paymentId)
      expect(payment.amountMinor).toBe(h.expected.amountMinor)
      expect(Number.isInteger(payment.amountMinor)).toBe(true)
      expect(payment.currency).toBe(h.expected.currency)
      expect(payment.providerCustomerId).toBe(h.expected.customer)
      expect(payment.attributionToken).toBe(FIXTURE_TOKEN)
      expect(payment.provider).toBe(h.connector.provider)
    })

    it("normalises a refund as a cumulative amount of the same payment", async () => {
      const h = harness()
      const refund = (await normalize(h, h.refund)).find((event) => event.type === "payment.refunded")
      expect(refund).toBeDefined()
      if (refund?.type !== "payment.refunded") return
      expect(refund.paymentReferences).toContain(h.expected.refundOf ?? h.expected.paymentId)
      expect(refund.cumulativeRefundedMinor).toBe(h.expected.refundCumulative)
      expect(refund.isChargeback).toBe(false)
    })

    it("yields nothing for an event it does not handle", async () => {
      const h = harness()
      expect(await normalize(h, h.unknown)).toEqual([])
    })

    it("refuses a malformed credential at setup", async () => {
      const h = harness()
      await expect(
        h.connector.connect({ apiKey: h.badKey, webhookUrl: "https://app.test/hook", generatedSecret: "s".repeat(43) }, h.http),
      ).rejects.toBeInstanceOf(ConnectorSetupError)
    })
  })
}

// --- Mercado Pago -----------------------------------------------------------

const MP_SECRET = "mp-webhook-secret-fixture"
function mpDelivery(body: { data: { id: string } }, secret: string, withSignature = true) {
  const ts = "1757000000"
  const requestId = "req-fixture-1"
  const v1 = signMercadoPago(mercadoPagoManifest(body.data.id, requestId, ts), secret)
  return delivery(body, withSignature ? { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId } : {}, `data.id=${body.data.id}&type=payment`)
}

describeConnector("Mercado Pago", () => {
  const payments: Record<string, unknown> = {
    "1000000001": mercadoPago.payment(),
    "1000000002": mercadoPago.payment({
      id: 1_000_000_002,
      transaction_amount: "200.00",
      transaction_amount_refunded: 50.25,
      status: "approved",
      status_detail: "partially_refunded",
    }),
  }
  const http: HttpClient = async (url) => {
    const id = url.split("/v1/payments/")[1]
    if (id && payments[id]) return jsonResponse(payments[id])
    return jsonResponse({ message: "not found" }, 404)
  }
  return {
    connector: new MercadoPagoConnector(),
    credentials: { accessToken: "APP_USR-fixture-token-0001", webhookSecret: MP_SECRET },
    environment: "live",
    signed: (body) => mpDelivery(body as { data: { id: string } }, MP_SECRET),
    forged: (body) => mpDelivery(body as { data: { id: string } }, "another-secret-000"),
    unauthenticated: (body) => mpDelivery(body as { data: { id: string } }, MP_SECRET, false),
    payment: mercadoPago.notification("1000000001"),
    refund: mercadoPago.notification("1000000002", "12345678902"),
    unknown: { ...mercadoPago.notification("777", "12345678903"), type: "point_integration_wh" },
    http,
    expected: {
      paymentId: "1000000001",
      amountMinor: 9451,
      currency: "BRL",
      customer: "900001",
      refundCumulative: 5025,
      refundOf: "1000000002",
    },
    connectInput: { apiKey: "APP_USR-fixture", webhookSecret: MP_SECRET },
    badKey: "sk_live_not_mercado_pago",
  }
})

describe("Mercado Pago specifics", () => {
  it("carries the SaaS customer id from metadata and a chargeback as its own fact", async () => {
    const connector = new MercadoPagoConnector()
    const credentials = { accessToken: "APP_USR-fixture-token-0001", webhookSecret: MP_SECRET }
    const http: HttpClient = async () =>
      jsonResponse(mercadoPago.payment({ status: "charged_back", status_detail: "settled" }))
    const verified = await connector.verify(mpDelivery(mercadoPago.notification("1000000001"), MP_SECRET), credentials)
    const events = await connector.normalize(verified, { credentials, environment: "live", http })
    expect(events.map((event) => event.type)).toEqual(["payment.succeeded", "payment.refunded"])
    const [paid, chargeback] = events
    expect(paid?.type === "payment.succeeded" && paid.externalCustomerId).toBe("user_42")
    expect(chargeback?.type === "payment.refunded" && chargeback.isChargeback).toBe(true)
  })

  it("records a rejected payment as a failure, not money", async () => {
    const connector = new MercadoPagoConnector()
    const credentials = { accessToken: "APP_USR-fixture-token-0001", webhookSecret: MP_SECRET }
    const http: HttpClient = async () => jsonResponse(mercadoPago.payment({ status: "rejected", status_detail: "cc_rejected_other_reason" }))
    const verified = await connector.verify(mpDelivery(mercadoPago.notification("1000000001"), MP_SECRET), credentials)
    const events = await connector.normalize(verified, { credentials, environment: "live", http })
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe("payment.failed")
  })

  it("validates the token against the payments API at setup, and cannot register webhooks", async () => {
    const connector = new MercadoPagoConnector()
    const ok = await connector.connect(
      { apiKey: "TEST-fixture-token", webhookSecret: MP_SECRET, webhookUrl: "https://app.test/h", generatedSecret: "x".repeat(43) },
      async () => jsonResponse({ results: [] }),
    )
    expect(ok).toMatchObject({ environment: "test", webhookRegistered: false })
    await expect(
      connector.connect(
        { apiKey: "APP_USR-revoked", webhookSecret: MP_SECRET, webhookUrl: "https://app.test/h", generatedSecret: "x".repeat(43) },
        async () => jsonResponse({}, 401),
      ),
    ).rejects.toMatchObject({ code: "invalid_credentials" })
  })

  it("lower-cases an alphanumeric data.id in the signed manifest", () => {
    expect(mercadoPagoManifest("ABC123", "r", "1")).toBe("id:abc123;request-id:r;ts:1;")
    expect(mercadoPagoManifest(null, null, "1")).toBe("ts:1;")
  })
})

// --- AbacatePay -------------------------------------------------------------

const ABACATE_SECRET = "a".repeat(43)
function abacateDelivery(body: unknown, secret: string, signature?: string) {
  const raw = JSON.stringify(body)
  return delivery(raw, { "x-webhook-signature": signature ?? signAbacatePay(raw) }, `webhookSecret=${secret}`)
}

describeConnector("AbacatePay", () => ({
  connector: new AbacatePayConnector(),
  credentials: { apiKey: "abc_prod_fixture_0001", webhookSecret: ABACATE_SECRET },
  environment: "live",
  signed: (body) => abacateDelivery(body, ABACATE_SECRET),
  forged: (body) => abacateDelivery(body, "b".repeat(43)),
  unauthenticated: (body) => abacateDelivery(body, ABACATE_SECRET, "bm90LWEtc2lnbmF0dXJl"),
  payment: abacatePay.completed(),
  refund: abacatePay.refunded(),
  unknown: abacatePay.unknown(),
  http: async () => jsonResponse({}),
  expected: { paymentId: "bill_fixture_0001", amountMinor: 4990, currency: "BRL", customer: "cust_fixture_0001", refundCumulative: 4990 },
  connectInput: { apiKey: "abc_prod_fixture" },
  badKey: "not-an-abacate-key",
}))

describe("AbacatePay specifics", () => {
  it("registers its own webhook with a generated secret and the documented events", async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const result = await new AbacatePayConnector().connect(
      { apiKey: "abc_dev_fixture_0001", webhookUrl: "https://app.test/api/webhooks/billing/abacatepay/x", generatedSecret: ABACATE_SECRET },
      async (url, init) => {
        calls.push({ url, body: JSON.parse(String(init?.body)) })
        return jsonResponse({ data: { id: "webh_fixture" } })
      },
    )
    expect(calls[0]?.url).toBe("https://api.abacatepay.com/v2/webhooks/create")
    expect(calls[0]?.body).toMatchObject({ secret: ABACATE_SECRET, events: [...ABACATEPAY_EVENTS] })
    expect(result).toMatchObject({ environment: "test", webhookRegistered: true, credentials: { webhookId: "webh_fixture" } })
  })

  it("needs both the URL secret and the body signature", async () => {
    const connector = new AbacatePayConnector()
    const credentials = { apiKey: "abc_prod_fixture_0001", webhookSecret: ABACATE_SECRET }
    const raw = JSON.stringify(abacatePay.completed())
    await expect(connector.verify(delivery(raw, {}, `webhookSecret=${ABACATE_SECRET}`), credentials)).rejects.toBeInstanceOf(
      WebhookAuthError,
    )
    await expect(connector.verify(delivery(raw, { "x-webhook-signature": signAbacatePay(raw) }), credentials)).rejects.toBeInstanceOf(
      WebhookAuthError,
    )
  })

  it("normalises a renewal to the subscription and its payment, in dev mode as test", async () => {
    const connector = new AbacatePayConnector()
    const credentials = { apiKey: "abc_dev_fixture_0001", webhookSecret: ABACATE_SECRET }
    const verified = await connector.verify(abacateDelivery(abacatePay.renewed(), ABACATE_SECRET), credentials)
    const events = await connector.normalize(verified, { credentials, environment: "test", http: async () => jsonResponse({}) })
    expect(events.map((event) => event.type)).toEqual(["subscription.updated", "payment.succeeded"])
    expect(events.every((event) => event.environment === "test")).toBe(true)
  })

  it("leaves a subscription's first checkout to the subscription event", async () => {
    const connector = new AbacatePayConnector()
    const credentials = { apiKey: "abc_prod_fixture_0001", webhookSecret: ABACATE_SECRET }
    const body = abacatePay.completed({ frequency: "SUBSCRIPTION" })
    const verified = await connector.verify(abacateDelivery(body, ABACATE_SECRET), credentials)
    expect(await connector.normalize(verified, { credentials, environment: "live", http: async () => jsonResponse({}) })).toEqual([])
  })
})

// --- Asaas --------------------------------------------------------------------

const ASAAS_TOKEN = "t".repeat(40)
describeConnector("Asaas", () => ({
  connector: new AsaasConnector(),
  credentials: { apiKey: "$aact_prod_fixture_0001", authToken: ASAAS_TOKEN },
  environment: "live",
  signed: (body) => delivery(body, { "asaas-access-token": ASAAS_TOKEN }),
  forged: (body) => delivery(body, { "asaas-access-token": "u".repeat(40) }),
  unauthenticated: (body) => delivery(body),
  payment: asaas.payment("PAYMENT_RECEIVED"),
  refund: asaas.payment("PAYMENT_PARTIALLY_REFUNDED", {
    refunds: [
      { value: 20, status: "DONE" },
      { value: 10.5, status: "PENDING" },
      { value: 99, status: "CANCELLED" },
    ],
  }),
  unknown: asaas.payment("PAYMENT_CREATED"),
  http: async () => jsonResponse({}),
  expected: { paymentId: "pay_fixture_0001", amountMinor: 14990, currency: "BRL", customer: "cus_fixture_0001", refundCumulative: 3050 },
  connectInput: { apiKey: "$aact_prod_fixture" },
  badKey: "sk_live_not_asaas",
}))

describe("Asaas specifics", () => {
  it("records CONFIRMED and RECEIVED of one payment under the same transaction id", async () => {
    const connector = new AsaasConnector()
    const credentials = { apiKey: "$aact_prod_fixture_0001", authToken: ASAAS_TOKEN }
    const run = async (event: string) => {
      const verified = await connector.verify(delivery(asaas.payment(event), { "asaas-access-token": ASAAS_TOKEN }), credentials)
      return connector.normalize(verified, { credentials, environment: "live", http: async () => jsonResponse({}) })
    }
    const [confirmed] = await run("PAYMENT_CONFIRMED")
    const [received] = await run("PAYMENT_RECEIVED")
    expect(confirmed?.type === "payment.succeeded" && confirmed.providerTransactionId).toBe("pay_fixture_0001")
    expect(received?.type === "payment.succeeded" && received.providerTransactionId).toBe("pay_fixture_0001")
  })

  it("takes its environment from the connection, since payloads carry none", async () => {
    const connector = new AsaasConnector()
    const credentials = { apiKey: "$aact_hmlg_fixture_0001", authToken: ASAAS_TOKEN }
    const verified = await connector.verify(delivery(asaas.payment("PAYMENT_RECEIVED"), { "asaas-access-token": ASAAS_TOKEN }), credentials)
    expect(verified.environment).toBeNull()
    const [event] = await connector.normalize(verified, { credentials, environment: "test", http: async () => jsonResponse({}) })
    expect(event?.environment).toBe("test")
  })

  it("registers the webhook on the sandbox host for a sandbox key", async () => {
    const urls: string[] = []
    const result = await new AsaasConnector().connect(
      { apiKey: "$aact_hmlg_fixture_0001", webhookUrl: "https://app.test/h", generatedSecret: ASAAS_TOKEN },
      async (url) => {
        urls.push(url)
        return jsonResponse({ id: "wh_fixture" })
      },
    )
    expect(urls).toEqual([`${ASAAS_API.test}/webhooks`])
    expect(result).toMatchObject({ environment: "test", webhookRegistered: true })
  })

  it("maps chargebacks, cancellations and failures", async () => {
    const connector = new AsaasConnector()
    const credentials = { apiKey: "$aact_prod_fixture_0001", authToken: ASAAS_TOKEN }
    const run = async (body: unknown) => {
      const verified = await connector.verify(delivery(body, { "asaas-access-token": ASAAS_TOKEN }), credentials)
      return connector.normalize(verified, { credentials, environment: "live", http: async () => jsonResponse({}) })
    }
    const [chargeback] = await run(asaas.payment("PAYMENT_CHARGEBACK_REQUESTED"))
    expect(chargeback?.type === "payment.refunded" && chargeback.isChargeback).toBe(true)
    expect((await run(asaas.subscription("SUBSCRIPTION_INACTIVATED")))[0]?.type).toBe("subscription.cancelled")
    expect((await run(asaas.payment("PAYMENT_OVERDUE")))[0]?.type).toBe("payment.failed")
    const [started] = await run(asaas.subscription("SUBSCRIPTION_CREATED"))
    expect(started?.type === "subscription.updated" && started.attributionToken).toBe(FIXTURE_TOKEN)
  })
})
