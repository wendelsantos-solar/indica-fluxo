import "server-only"

import { createHash, createHmac } from "node:crypto"

import { z } from "zod"

import { safeEqual } from "@/lib/crypto/hash"
import { readAttributionToken } from "@/lib/tracking/attribution-token"

import {
  ConnectorSetupError,
  WebhookAuthError,
  parseJson,
  type BillingConnector,
  type ConnectInput,
  type HttpClient,
  type NormalizeContext,
  type WebhookDelivery,
} from "../connector"
import type { BillingEnvironment, BillingEventBase, NormalizedBillingEvent, VerifiedWebhook } from "../types"

/**
 * AbacatePay, API v2 (BILLING_PROVIDER_MATRIX.md). Beta.
 *
 * - Connection: the merchant pastes an API key (`abc_prod_…` / `abc_dev_…`);
 *   the product registers the webhook itself (`POST /v2/webhooks/create`) with a
 *   secret it generated for this connection. No step in the AbacatePay panel.
 * - Deliveries carry that secret as `?webhookSecret=` AND an
 *   `X-Webhook-Signature` = base64 HMAC-SHA256 of the raw body with AbacatePay's
 *   **public, global** key. The HMAC proves "from AbacatePay"; only the secret
 *   proves "for this connection", so both are required.
 * - Amounts are integer centavos; BRL only. Refunds are full only; there is no
 *   "dispute won" event (capabilities say so).
 */

export const ABACATEPAY_API = "https://api.abacatepay.com/v2"

/**
 * The HMAC key AbacatePay publishes for webhook signatures
 * (docs.abacatepay.com/pages/webhooks/security). Public by design — it is the
 * same for every merchant — so it is not a secret and lives in code.
 */
export const ABACATEPAY_PUBLIC_HMAC_KEY =
  "t9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9"

/** The events the product subscribes to when it registers the webhook. */
export const ABACATEPAY_EVENTS = [
  "checkout.completed",
  "checkout.refunded",
  "checkout.disputed",
  "checkout.lost",
  "transparent.completed",
  "transparent.refunded",
  "transparent.disputed",
  "transparent.lost",
  "subscription.completed",
  "subscription.renewed",
  "subscription.cancelled",
  "subscription.trial_started",
] as const

const credentialsSchema = z.object({
  apiKey: z.string().min(10),
  webhookSecret: z.string().min(32),
  webhookId: z.string().optional(),
})

export function abacatePayEnvironment(apiKey: string): BillingEnvironment | null {
  if (apiKey.startsWith("abc_dev_")) return "test"
  if (apiKey.startsWith("abc_prod_")) return "live"
  return null
}

export function signAbacatePay(rawBody: string): string {
  return createHmac("sha256", ABACATEPAY_PUBLIC_HMAC_KEY).update(Buffer.from(rawBody, "utf8")).digest("base64")
}

const envelopeSchema = z
  .object({
    id: z.string().optional(),
    event: z.string(),
    devMode: z.boolean().optional(),
    data: z.record(z.string(), z.unknown()).default({}),
  })
  .loose()

const chargeSchema = z
  .object({
    id: z.string(),
    amount: z.number().int().nullish(),
    paidAmount: z.number().int().nullish(),
    externalId: z.string().nullish(),
    customerId: z.string().nullish(),
    frequency: z.string().nullish(),
    createdAt: z.string().nullish(),
    updatedAt: z.string().nullish(),
  })
  .loose()

const customerSchema = z.object({ id: z.string().nullish() }).loose()

const subscriptionSchema = z
  .object({
    id: z.string(),
    amount: z.number().int().nullish(),
    frequency: z.string().nullish(),
    customerId: z.string().nullish(),
    createdAt: z.string().nullish(),
  })
  .loose()

function parseOptional<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function dateOr(value: string | null | undefined): Date {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date : new Date()
}

const INTERVAL: Record<string, "day" | "week" | "month" | "year"> = {
  WEEKLY: "week",
  MONTHLY: "month",
  QUARTERLY: "month",
  SEMIANNUALLY: "month",
  ANNUALLY: "year",
  YEARLY: "year",
}

export class AbacatePayConnector implements BillingConnector {
  readonly provider = "abacatepay" as const

  async verify(delivery: WebhookDelivery, credentials: unknown): Promise<VerifiedWebhook> {
    const parsedCredentials = credentialsSchema.safeParse(credentials)
    if (!parsedCredentials.success) throw new WebhookAuthError("malformed")

    const presentedSecret = delivery.query.get("webhookSecret")
    const signature = delivery.header("x-webhook-signature")
    if (!presentedSecret || !signature) throw new WebhookAuthError("missing")
    if (!safeEqual(presentedSecret, parsedCredentials.data.webhookSecret)) throw new WebhookAuthError("mismatch")
    if (!safeEqual(signAbacatePay(delivery.rawBody), signature)) throw new WebhookAuthError("mismatch")

    const envelope = envelopeSchema.safeParse(parseJson(delivery.rawBody))
    if (!envelope.success) throw new WebhookAuthError("malformed")

    return {
      // `log_…`, the same on every retry. A body without one (not seen in the
      // docs) is still deduplicated by its content.
      providerEventId: envelope.data.id ?? `body_${createHash("sha256").update(delivery.rawBody).digest("hex").slice(0, 32)}`,
      rawType: envelope.data.event,
      providerAccountId: null,
      environment: envelope.data.devMode === undefined ? null : envelope.data.devMode ? "test" : "live",
      payload: envelope.data,
    }
  }

  async normalize(verified: VerifiedWebhook, context: NormalizeContext): Promise<NormalizedBillingEvent[]> {
    const envelope = envelopeSchema.parse(verified.payload)
    const data = envelope.data
    const environment = verified.environment ?? context.environment ?? "live"
    const base = (occurredAt: Date): BillingEventBase => ({
      provider: "abacatepay",
      providerEventId: verified.providerEventId,
      rawType: verified.rawType,
      occurredAt,
      providerAccountId: null,
      environment,
    })
    const [family, action] = envelope.event.split(".") as [string, string | undefined]
    const customerId = parseOptional(customerSchema, data.customer)?.id ?? null

    if (family === "checkout" || family === "transparent") {
      const charge = parseOptional(chargeSchema, data.checkout ?? data.transparent ?? data.payment)
      if (!charge) return []
      const customer = charge.customerId ?? customerId
      const amount = charge.paidAmount ?? charge.amount ?? 0
      switch (action) {
        case "completed":
          // A subscription's first charge is reported by `subscription.completed`.
          if (charge.frequency?.toUpperCase() === "SUBSCRIPTION") return []
          if (amount <= 0) return []
          return [
            {
              ...base(dateOr(charge.updatedAt ?? charge.createdAt)),
              type: "payment.succeeded",
              providerTransactionId: charge.id,
              providerReferences: [],
              providerCustomerId: customer,
              providerSubscriptionId: null,
              customerEmail: null,
              currency: "BRL",
              amountMinor: amount,
              attributionToken: readAttributionToken(charge.externalId),
            },
          ]
        case "refunded":
          // Full refunds only (AbacatePay: "reembolso total apenas").
          return [
            {
              ...base(new Date()),
              type: "payment.refunded",
              providerTransactionId: `${charge.id}:refund`,
              paymentReferences: [charge.id],
              providerCustomerId: customer,
              currency: "BRL",
              amountMinor: amount,
              cumulativeRefundedMinor: amount,
              isChargeback: false,
            },
          ]
        case "disputed":
          return [
            {
              ...base(new Date()),
              type: "payment.refunded",
              providerTransactionId: `dispute_${charge.id}`,
              paymentReferences: [charge.id],
              providerCustomerId: customer,
              currency: "BRL",
              amountMinor: amount,
              isChargeback: true,
            },
          ]
        default:
          // `*.lost` keeps the chargeback already recorded at `*.disputed`.
          return []
      }
    }

    if (family === "subscription") {
      const subscription = parseOptional(subscriptionSchema, data.subscription)
      const payment = parseOptional(chargeSchema, data.payment)
      const checkout = parseOptional(chargeSchema, data.checkout)
      if (!subscription) return []
      const customer = subscription.customerId ?? checkout?.customerId ?? customerId
      const token = readAttributionToken(payment?.externalId) ?? readAttributionToken(checkout?.externalId)

      if (action === "cancelled") {
        return [
          {
            ...base(new Date()),
            type: "subscription.cancelled",
            providerSubscriptionId: subscription.id,
            providerCustomerId: customer,
            cancelledAt: new Date(),
          },
        ]
      }
      if (action === "payment_failed") {
        return [
          {
            ...base(new Date()),
            type: "payment.failed",
            providerTransactionId: payment?.id ?? subscription.id,
            providerCustomerId: customer,
            reason: "subscription_payment_failed",
          },
        ]
      }
      if (!customer || (action !== "completed" && action !== "renewed" && action !== "trial_started")) return []

      const amount = payment?.paidAmount ?? payment?.amount ?? checkout?.paidAmount ?? subscription.amount ?? 0
      const events: NormalizedBillingEvent[] = [
        {
          ...base(dateOr(subscription.createdAt)),
          type: "subscription.updated",
          customerEmail: null,
          attributionToken: token,
          subscription: {
            providerSubscriptionId: subscription.id,
            providerCustomerId: customer,
            status: action === "trial_started" ? "trialing" : "active",
            currency: "BRL",
            amountMinor: subscription.amount ?? amount,
            interval: INTERVAL[(subscription.frequency ?? "MONTHLY").toUpperCase()] ?? "month",
            startedAt: dateOr(subscription.createdAt),
            currentPeriodStart: null,
            currentPeriodEnd: null,
            cancelledAt: null,
          },
        },
      ]
      const paymentId = payment?.id ?? checkout?.id
      if (action !== "trial_started" && paymentId && amount > 0) {
        events.push({
          ...base(dateOr(payment?.updatedAt ?? payment?.createdAt)),
          type: "payment.succeeded",
          providerTransactionId: paymentId,
          providerReferences: payment && checkout && payment.id !== checkout.id ? [checkout.id] : [],
          providerCustomerId: customer,
          providerSubscriptionId: subscription.id,
          customerEmail: null,
          currency: "BRL",
          amountMinor: amount,
          attributionToken: token,
        })
      }
      return events
    }

    return []
  }

  async connect(input: ConnectInput, http: HttpClient) {
    const environment = abacatePayEnvironment(input.apiKey)
    if (!environment) throw new ConnectorSetupError("invalid_credentials")

    const response = await http(`${ABACATEPAY_API}/webhooks/create`, {
      method: "POST",
      headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Affiliate attribution",
        endpoint: input.webhookUrl,
        secret: input.generatedSecret,
        events: ABACATEPAY_EVENTS,
      }),
    }).catch(() => null)

    if (!response) throw new ConnectorSetupError("provider_unavailable")
    if (response.status === 401 || response.status === 403) throw new ConnectorSetupError("invalid_credentials", response.status)
    if (!response.ok) throw new ConnectorSetupError("webhook_registration_failed", response.status)

    const body = z
      .object({ data: z.object({ id: z.string() }).loose().nullish(), id: z.string().nullish() })
      .loose()
      .safeParse(await response.json().catch(() => null))
    const webhookId = body.success ? (body.data.data?.id ?? body.data.id ?? undefined) : undefined

    return {
      credentials: {
        apiKey: input.apiKey,
        webhookSecret: input.generatedSecret,
        ...(webhookId ? { webhookId } : {}),
      },
      environment,
      providerAccountId: null,
      webhookRegistered: true,
    }
  }
}
