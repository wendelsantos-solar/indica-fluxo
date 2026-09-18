import "server-only"

import { createHmac } from "node:crypto"

import { z } from "zod"

import { safeEqual } from "@/lib/crypto/hash"
import { decimalToMinor } from "@/lib/money"
import {
  readAttributionToken,
  readAttributionTokenFromMetadata,
  readExternalCustomerIdFromMetadata,
} from "@/lib/tracking/attribution-token"

import {
  ConnectorFetchError,
  ConnectorSetupError,
  WebhookAuthError,
  parseJson,
  type BillingConnector,
  type ConnectInput,
  type HttpClient,
  type NormalizeContext,
  type WebhookDelivery,
} from "../connector"
import type {
  BillingEnvironment,
  BillingEventBase,
  NormalizedBillingEvent,
  ProviderSubscription,
  VerifiedWebhook,
} from "../types"

/**
 * Mercado Pago (BILLING_PROVIDER_MATRIX.md). Beta.
 *
 * - Connection: the merchant pastes an access token (`APP_USR-…` production,
 *   `TEST-…` test) and the signature secret of their application's webhook.
 *   Mercado Pago documents no API to register a webhook, so the merchant adds
 *   our URL in their panel — two honest manual steps.
 * - Deliveries are signed: `x-signature: ts=…,v1=…`, HMAC-SHA256 (hex) of
 *   `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` with that secret.
 * - Notifications are thin (`data.id`): the payment is fetched with the
 *   merchant's own token from the fixed API host, never from a payload URL.
 * - Amounts are decimals → `decimalToMinor`, never float multiplication.
 * - Refunds are reported as a cumulative total (`transaction_amount_refunded`).
 */

export const MERCADO_PAGO_API = "https://api.mercadopago.com"

const credentialsSchema = z.object({
  accessToken: z.string().min(10),
  webhookSecret: z.string().min(8),
})

export type MercadoPagoCredentials = z.infer<typeof credentialsSchema>

/** `APP_USR-` production / `TEST-` test credentials (MP token reference). */
/**
 * The notification topics the founder ticks in the Mercado Pago panel — the
 * ones `normalize` reads. Shown verbatim on the connection page and the guide.
 */
export const MERCADO_PAGO_TOPICS = [
  "payment",
  "subscription_preapproval",
  "subscription_authorized_payment",
  "topic_chargebacks_wh",
] as const

export function mercadoPagoEnvironment(accessToken: string): BillingEnvironment | null {
  if (accessToken.startsWith("TEST-")) return "test"
  if (accessToken.startsWith("APP_USR-")) return "live"
  return null
}

const notificationSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    type: z.string().optional(),
    topic: z.string().optional(),
    action: z.string().optional(),
    live_mode: z.boolean().optional(),
    user_id: z.union([z.string(), z.number()]).optional(),
    data: z.object({ id: z.union([z.string(), z.number()]).optional() }).loose().optional(),
  })
  .loose()

interface MercadoPagoPayload {
  kind: string
  resourceId: string
  userId: string | null
}

const paymentSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    status: z.string(),
    status_detail: z.string().nullish(),
    transaction_amount: z.union([z.number(), z.string()]),
    transaction_amount_refunded: z.union([z.number(), z.string()]).nullish(),
    currency_id: z.string().length(3),
    external_reference: z.string().nullish(),
    metadata: z.record(z.string(), z.unknown()).nullish(),
    live_mode: z.boolean().nullish(),
    date_approved: z.string().nullish(),
    date_created: z.string().nullish(),
    operation_type: z.string().nullish(),
    payer: z
      .object({ id: z.union([z.string(), z.number()]).nullish(), email: z.string().nullish() })
      .loose()
      .nullish(),
  })
  .loose()

type MercadoPagoPayment = z.infer<typeof paymentSchema>

const preapprovalSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    payer_id: z.union([z.string(), z.number()]).nullish(),
    external_reference: z.string().nullish(),
    date_created: z.string().nullish(),
    auto_recurring: z
      .object({
        frequency: z.number().nullish(),
        frequency_type: z.string().nullish(),
        transaction_amount: z.union([z.number(), z.string()]).nullish(),
        currency_id: z.string().nullish(),
      })
      .loose()
      .nullish(),
  })
  .loose()

const authorizedPaymentSchema = z
  .object({
    preapproval_id: z.string().nullish(),
    payment: z.object({ id: z.union([z.string(), z.number()]).nullish() }).loose().nullish(),
  })
  .loose()

const chargebackSchema = z
  .object({ payments: z.array(z.union([z.string(), z.number()])).nullish() })
  .loose()

function parseSignature(header: string | null): { ts: string; v1: string } | null {
  if (!header) return null
  const parts = Object.fromEntries(
    header.split(",").map((part) => {
      const [key, ...rest] = part.split("=")
      return [key?.trim() ?? "", rest.join("=").trim()]
    }),
  )
  return parts.ts && parts.v1 ? { ts: parts.ts, v1: parts.v1 } : null
}

/**
 * The documented manifest. An alphanumeric `data.id` is lower-cased; a part
 * whose value is missing is left out.
 */
export function mercadoPagoManifest(dataId: string | null, requestId: string | null, ts: string): string {
  const id = dataId && /[a-z]/i.test(dataId) ? dataId.toLowerCase() : dataId
  return `${id ? `id:${id};` : ""}${requestId ? `request-id:${requestId};` : ""}ts:${ts};`
}

export function signMercadoPago(manifest: string, secret: string): string {
  return createHmac("sha256", secret).update(manifest).digest("hex")
}

function idString(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null
  return String(value)
}

const STATUS_MAP: Record<string, ProviderSubscription["status"]> = {
  authorized: "active",
  pending: "incomplete",
  paused: "past_due",
  cancelled: "cancelled",
  canceled: "cancelled",
}

const FREQUENCY_MAP: Record<string, ProviderSubscription["interval"]> = {
  days: "day",
  months: "month",
}

export class MercadoPagoConnector implements BillingConnector {
  readonly provider = "mercado_pago" as const

  async verify(delivery: WebhookDelivery, credentials: unknown): Promise<VerifiedWebhook> {
    const parsedCredentials = credentialsSchema.safeParse(credentials)
    if (!parsedCredentials.success) throw new WebhookAuthError("malformed")

    const signature = parseSignature(delivery.header("x-signature"))
    if (!signature) throw new WebhookAuthError("missing")

    // `data.id` comes from the URL (the docs' manifest source), else the body.
    const body = notificationSchema.safeParse(parseJson(delivery.rawBody))
    const dataId =
      delivery.query.get("data.id") ?? delivery.query.get("id") ?? idString(body.success ? body.data.data?.id : null)
    const requestId = delivery.header("x-request-id")

    const expected = signMercadoPago(mercadoPagoManifest(dataId, requestId, signature.ts), parsedCredentials.data.webhookSecret)
    if (!safeEqual(expected, signature.v1)) throw new WebhookAuthError("mismatch")

    // Authenticated from here on.
    if (!body.success || !dataId) throw new WebhookAuthError("malformed")
    const kind = body.data.type ?? body.data.topic ?? delivery.query.get("type") ?? delivery.query.get("topic") ?? "unknown"
    const payload: MercadoPagoPayload = { kind, resourceId: dataId, userId: idString(body.data.user_id) }

    return {
      // Retries of one notification keep its id; without one, the request id.
      providerEventId: idString(body.data.id) ?? requestId ?? `${kind}:${dataId}:${signature.ts}`,
      rawType: body.data.action ?? kind,
      providerAccountId: payload.userId,
      environment: body.data.live_mode === undefined ? null : body.data.live_mode ? "live" : "test",
      payload,
    }
  }

  async normalize(verified: VerifiedWebhook, context: NormalizeContext): Promise<NormalizedBillingEvent[]> {
    const credentials = credentialsSchema.parse(context.credentials)
    const payload = verified.payload as MercadoPagoPayload
    const get = (path: string) => fetchJson(context.http, credentials.accessToken, path)
    const base = (occurredAt: Date, environment: BillingEnvironment): BillingEventBase => ({
      provider: "mercado_pago",
      providerEventId: verified.providerEventId,
      rawType: verified.rawType,
      occurredAt,
      providerAccountId: verified.providerAccountId,
      environment,
    })
    const fallbackEnvironment = verified.environment ?? context.environment ?? "live"

    switch (payload.kind) {
      case "payment": {
        const payment = await get(`/v1/payments/${encodeURIComponent(payload.resourceId)}`)
        if (payment === null) return []
        return paymentEvents(paymentSchema.parse(payment), null, base, fallbackEnvironment)
      }

      case "subscription_authorized_payment": {
        const invoice = await get(`/authorized_payments/${encodeURIComponent(payload.resourceId)}`)
        if (invoice === null) return []
        const parsed = authorizedPaymentSchema.parse(invoice)
        const paymentId = idString(parsed.payment?.id)
        if (!paymentId) return []
        const payment = await get(`/v1/payments/${encodeURIComponent(paymentId)}`)
        if (payment === null) return []
        return paymentEvents(paymentSchema.parse(payment), parsed.preapproval_id ?? null, base, fallbackEnvironment)
      }

      case "subscription_preapproval": {
        const found = await get(`/preapproval/${encodeURIComponent(payload.resourceId)}`)
        if (found === null) return []
        const preapproval = preapprovalSchema.parse(found)
        const occurredAt = dateOr(preapproval.date_created)
        const customer = idString(preapproval.payer_id)
        const status = STATUS_MAP[preapproval.status] ?? "incomplete"
        if (status === "cancelled") {
          return [
            {
              ...base(occurredAt, fallbackEnvironment),
              type: "subscription.cancelled",
              providerSubscriptionId: preapproval.id,
              providerCustomerId: customer,
              cancelledAt: new Date(),
            },
          ]
        }
        if (!customer) return []
        const currency = (preapproval.auto_recurring?.currency_id ?? "BRL").toUpperCase()
        return [
          {
            ...base(occurredAt, fallbackEnvironment),
            type: "subscription.updated",
            customerEmail: null,
            attributionToken: readAttributionToken(preapproval.external_reference),
            subscription: {
              providerSubscriptionId: preapproval.id,
              providerCustomerId: customer,
              status,
              currency,
              amountMinor: decimalToMinor(preapproval.auto_recurring?.transaction_amount ?? 0, currency) ?? 0,
              interval: FREQUENCY_MAP[preapproval.auto_recurring?.frequency_type ?? "months"] ?? "month",
              startedAt: occurredAt,
              currentPeriodStart: null,
              currentPeriodEnd: null,
              cancelledAt: null,
            },
          },
        ]
      }

      case "topic_chargebacks_wh":
      case "chargebacks": {
        const chargeback = await get(`/v1/chargebacks/${encodeURIComponent(payload.resourceId)}`)
        if (chargeback === null) return []
        const paymentId = idString(chargebackSchema.parse(chargeback).payments?.[0])
        if (!paymentId) return []
        const payment = await get(`/v1/payments/${encodeURIComponent(paymentId)}`)
        if (payment === null) return []
        return paymentEvents(paymentSchema.parse(payment), null, base, fallbackEnvironment)
      }

      default:
        return []
    }
  }

  async connect(input: ConnectInput, http: HttpClient) {
    const environment = mercadoPagoEnvironment(input.apiKey)
    if (!environment) throw new ConnectorSetupError("invalid_credentials")
    // The signature secret only exists once the merchant saved our URL in their
    // panel — which needs this connection's URL first. So it may come later
    // (`withWebhookSecret`); until then deliveries cannot verify.
    if (input.webhookSecret !== undefined && input.webhookSecret.length < 8) {
      throw new ConnectorSetupError("invalid_credentials")
    }

    // A read the token must be allowed to make: its own payments.
    const response = await http(`${MERCADO_PAGO_API}/v1/payments/search?limit=1`, {
      headers: { authorization: `Bearer ${input.apiKey}` },
    }).catch(() => null)
    if (!response) throw new ConnectorSetupError("provider_unavailable")
    if (response.status === 401 || response.status === 403) throw new ConnectorSetupError("invalid_credentials", response.status)
    if (!response.ok) throw new ConnectorSetupError("provider_unavailable", response.status)

    return {
      credentials: { accessToken: input.apiKey, ...(input.webhookSecret ? { webhookSecret: input.webhookSecret } : {}) },
      environment,
      // Learned from the first notification's `user_id`.
      providerAccountId: null,
      webhookRegistered: false,
    }
  }
}

/** Adds the panel's signature secret to stored credentials (step 2 of the setup). */
export function withWebhookSecret(credentials: unknown, webhookSecret: string): Record<string, string> {
  const current = z.object({ accessToken: z.string().min(10) }).loose().parse(credentials)
  if (webhookSecret.trim().length < 8) throw new ConnectorSetupError("invalid_credentials")
  return { accessToken: current.accessToken, webhookSecret: webhookSecret.trim() }
}

/** Whether a connection's stored credentials can verify deliveries yet. */
export function hasWebhookSecret(credentials: unknown): boolean {
  return credentialsSchema.safeParse(credentials).success
}

async function fetchJson(http: HttpClient, accessToken: string, path: string): Promise<unknown> {
  let response: Response
  try {
    response = await http(`${MERCADO_PAGO_API}${path}`, { headers: { authorization: `Bearer ${accessToken}` } })
  } catch {
    throw new ConnectorFetchError(null)
  }
  // The panel's simulator notifies ids that do not exist: nothing to record.
  if (response.status === 404) return null
  if (!response.ok) throw new ConnectorFetchError(response.status)
  return response.json()
}

function dateOr(value: string | null | undefined): Date {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date : new Date()
}

/**
 * One payment state → the facts it states. State-based on purpose: every
 * notification of a payment yields the same facts, and the ledger's own ids
 * make repeating them a no-op.
 */
function paymentEvents(
  payment: MercadoPagoPayment,
  subscriptionId: string | null,
  base: (occurredAt: Date, environment: BillingEnvironment) => BillingEventBase,
  fallbackEnvironment: BillingEnvironment,
): NormalizedBillingEvent[] {
  const id = String(payment.id)
  const currency = payment.currency_id.toUpperCase()
  const environment: BillingEnvironment =
    payment.live_mode === true ? "live" : payment.live_mode === false ? "test" : fallbackEnvironment
  const customer = idString(payment.payer?.id)
  const occurredAt = dateOr(payment.date_approved ?? payment.date_created)

  if (payment.status === "rejected" || payment.status === "cancelled") {
    return [
      {
        ...base(occurredAt, environment),
        type: "payment.failed",
        providerTransactionId: id,
        providerCustomerId: customer,
        reason: (payment.status_detail ?? payment.status).slice(0, 64),
      },
    ]
  }

  if (payment.status !== "approved" && payment.status !== "refunded" && payment.status !== "charged_back") return []

  const amountMinor = decimalToMinor(payment.transaction_amount, currency)
  if (amountMinor === null) throw new Error("mercado pago payment amount is not a decimal")

  const events: NormalizedBillingEvent[] = [
    {
      ...base(occurredAt, environment),
      type: "payment.succeeded",
      providerTransactionId: id,
      providerReferences: [],
      providerCustomerId: customer,
      providerSubscriptionId: subscriptionId,
      customerEmail: payment.payer?.email ?? null,
      currency,
      amountMinor,
      attributionToken:
        readAttributionToken(payment.external_reference) ?? readAttributionTokenFromMetadata(payment.metadata),
      externalCustomerId: readExternalCustomerIdFromMetadata(payment.metadata),
    },
  ]

  const refunded = decimalToMinor(payment.transaction_amount_refunded ?? 0, currency) ?? 0
  if (refunded > 0) {
    events.push({
      ...base(new Date(), environment),
      type: "payment.refunded",
      providerTransactionId: `${id}:refund`,
      paymentReferences: [id],
      providerCustomerId: customer,
      currency,
      amountMinor: refunded,
      cumulativeRefundedMinor: refunded,
      isChargeback: false,
    })
  }

  if (payment.status === "charged_back") {
    events.push({
      ...base(new Date(), environment),
      type: "payment.refunded",
      providerTransactionId: `cb_${id}`,
      paymentReferences: [id],
      providerCustomerId: customer,
      currency,
      amountMinor: Math.max(amountMinor - refunded, 0),
      isChargeback: true,
    })
  }

  return events
}
