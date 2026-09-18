import "server-only"

import { z } from "zod"

import { BRAND } from "@/lib/brand"
import { safeEqual } from "@/lib/crypto/hash"
import { decimalToMinor } from "@/lib/money"
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
import type {
  BillingEnvironment,
  BillingEventBase,
  NormalizedBillingEvent,
  ProviderSubscription,
  VerifiedWebhook,
} from "../types"

/**
 * Asaas, API v3 (BILLING_PROVIDER_MATRIX.md). Beta.
 *
 * - Connection: the merchant pastes an API key (`$aact_prod_…` production on
 *   api.asaas.com, `$aact_hmlg_…` sandbox on api-sandbox.asaas.com). The
 *   product registers the webhook itself (`POST /v3/webhooks`) with an
 *   `authToken` it generated for this connection.
 * - Deliveries carry that token in `asaas-access-token`. Asaas signs nothing
 *   else (no HMAC), so the constant-time comparison is the whole proof.
 * - Payloads carry no live/test flag: the connection's key decides.
 * - Money in is the FIRST of `PAYMENT_CONFIRMED` / `PAYMENT_RECEIVED` per
 *   payment (card and boleto send both, Pix only RECEIVED); both normalise to
 *   the same `pay_…` transaction, which the ledger records once.
 * - `value` is a decimal → `decimalToMinor`. BRL only.
 */

export const ASAAS_API = { live: "https://api.asaas.com/v3", test: "https://api-sandbox.asaas.com/v3" } as const

export const ASAAS_EVENTS = [
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_REFUNDED",
  "PAYMENT_PARTIALLY_REFUNDED",
  "PAYMENT_CHARGEBACK_REQUESTED",
  "PAYMENT_OVERDUE",
  "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
  "PAYMENT_REPROVED_BY_RISK_ANALYSIS",
  "SUBSCRIPTION_CREATED",
  "SUBSCRIPTION_UPDATED",
  "SUBSCRIPTION_INACTIVATED",
  "SUBSCRIPTION_DELETED",
] as const

const credentialsSchema = z.object({
  apiKey: z.string().min(10),
  authToken: z.string().min(32),
  webhookId: z.string().optional(),
})

export function asaasEnvironment(apiKey: string): BillingEnvironment | null {
  if (apiKey.startsWith("$aact_hmlg_")) return "test"
  if (apiKey.startsWith("$aact_prod_")) return "live"
  return null
}

// Lenient on purpose: Asaas adds fields over time and warns that a receiver
// that rejects unknown fields gets its queue interrupted.
const envelopeSchema = z
  .object({
    id: z.string(),
    event: z.string(),
    dateCreated: z.string().nullish(),
    payment: z.unknown().optional(),
    subscription: z.unknown().optional(),
  })
  .loose()

const paymentSchema = z
  .object({
    id: z.string(),
    customer: z.string().nullish(),
    subscription: z.string().nullish(),
    value: z.union([z.number(), z.string()]),
    externalReference: z.string().nullish(),
    status: z.string().nullish(),
    dateCreated: z.string().nullish(),
    confirmedDate: z.string().nullish(),
    paymentDate: z.string().nullish(),
    refunds: z
      .array(z.object({ value: z.union([z.number(), z.string()]), status: z.string().nullish() }).loose())
      .nullish(),
  })
  .loose()

const subscriptionSchema = z
  .object({
    id: z.string(),
    customer: z.string().nullish(),
    value: z.union([z.number(), z.string()]).nullish(),
    cycle: z.string().nullish(),
    status: z.string().nullish(),
    externalReference: z.string().nullish(),
    dateCreated: z.string().nullish(),
  })
  .loose()

const CYCLE: Record<string, ProviderSubscription["interval"]> = {
  WEEKLY: "week",
  BIWEEKLY: "week",
  MONTHLY: "month",
  BIMONTHLY: "month",
  QUARTERLY: "month",
  SEMIANNUALLY: "month",
  YEARLY: "year",
}

function dateOr(value: string | null | undefined): Date {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date : new Date()
}

function minor(value: unknown): number {
  const amount = decimalToMinor(value, "BRL")
  if (amount === null) throw new Error("asaas amount is not a decimal")
  return amount
}

export class AsaasConnector implements BillingConnector {
  readonly provider = "asaas" as const

  async verify(delivery: WebhookDelivery, credentials: unknown): Promise<VerifiedWebhook> {
    const parsedCredentials = credentialsSchema.safeParse(credentials)
    if (!parsedCredentials.success) throw new WebhookAuthError("malformed")

    const presented = delivery.header("asaas-access-token")
    if (!presented) throw new WebhookAuthError("missing")
    if (!safeEqual(presented, parsedCredentials.data.authToken)) throw new WebhookAuthError("mismatch")

    const envelope = envelopeSchema.safeParse(parseJson(delivery.rawBody))
    if (!envelope.success) throw new WebhookAuthError("malformed")

    return {
      providerEventId: envelope.data.id,
      rawType: envelope.data.event,
      providerAccountId: null,
      environment: null,
      payload: envelope.data,
    }
  }

  async normalize(verified: VerifiedWebhook, context: NormalizeContext): Promise<NormalizedBillingEvent[]> {
    const envelope = envelopeSchema.parse(verified.payload)
    const environment = context.environment ?? "live"
    const base = (occurredAt: Date): BillingEventBase => ({
      provider: "asaas",
      providerEventId: verified.providerEventId,
      rawType: verified.rawType,
      occurredAt,
      providerAccountId: null,
      environment,
    })

    if (envelope.event.startsWith("PAYMENT_")) {
      const parsed = paymentSchema.safeParse(envelope.payment)
      if (!parsed.success) return []
      const payment = parsed.data
      const occurredAt = dateOr(payment.confirmedDate ?? payment.paymentDate ?? envelope.dateCreated ?? payment.dateCreated)

      switch (envelope.event) {
        case "PAYMENT_CONFIRMED":
        case "PAYMENT_RECEIVED": {
          const amountMinor = minor(payment.value)
          if (amountMinor <= 0) return []
          return [
            {
              ...base(occurredAt),
              type: "payment.succeeded",
              providerTransactionId: payment.id,
              providerReferences: [],
              providerCustomerId: payment.customer ?? null,
              providerSubscriptionId: payment.subscription ?? null,
              customerEmail: null,
              currency: "BRL",
              amountMinor,
              attributionToken: readAttributionToken(payment.externalReference),
            },
          ]
        }
        case "PAYMENT_REFUNDED":
        case "PAYMENT_PARTIALLY_REFUNDED": {
          // `refunds[]` is treated as cumulative (not documented either way):
          // the core records only what is not recorded yet.
          const fromList = (payment.refunds ?? [])
            .filter((refund) => (refund.status ?? "DONE").toUpperCase() !== "CANCELLED")
            .reduce((sum, refund) => sum + minor(refund.value), 0)
          const cumulative = envelope.event === "PAYMENT_REFUNDED" && fromList === 0 ? minor(payment.value) : fromList
          if (cumulative <= 0) return []
          return [
            {
              ...base(new Date()),
              type: "payment.refunded",
              providerTransactionId: `${payment.id}:refund`,
              paymentReferences: [payment.id],
              providerCustomerId: payment.customer ?? null,
              currency: "BRL",
              amountMinor: cumulative,
              cumulativeRefundedMinor: cumulative,
              isChargeback: false,
            },
          ]
        }
        case "PAYMENT_CHARGEBACK_REQUESTED":
          return [
            {
              ...base(new Date()),
              type: "payment.refunded",
              providerTransactionId: `cb_${payment.id}`,
              paymentReferences: [payment.id],
              providerCustomerId: payment.customer ?? null,
              currency: "BRL",
              amountMinor: minor(payment.value),
              isChargeback: true,
            },
          ]
        case "PAYMENT_OVERDUE":
        case "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED":
        case "PAYMENT_REPROVED_BY_RISK_ANALYSIS":
          return [
            {
              ...base(new Date()),
              type: "payment.failed",
              providerTransactionId: payment.id,
              providerCustomerId: payment.customer ?? null,
              reason: envelope.event.replace("PAYMENT_", "").toLowerCase().slice(0, 64),
            },
          ]
        default:
          return []
      }
    }

    if (envelope.event.startsWith("SUBSCRIPTION_")) {
      const parsed = subscriptionSchema.safeParse(envelope.subscription)
      if (!parsed.success) return []
      const subscription = parsed.data
      const occurredAt = dateOr(subscription.dateCreated ?? envelope.dateCreated)
      const inactive =
        envelope.event === "SUBSCRIPTION_INACTIVATED" ||
        envelope.event === "SUBSCRIPTION_DELETED" ||
        (subscription.status ?? "").toUpperCase() === "INACTIVE" ||
        (subscription.status ?? "").toUpperCase() === "EXPIRED"

      if (inactive) {
        return [
          {
            ...base(new Date()),
            type: "subscription.cancelled",
            providerSubscriptionId: subscription.id,
            providerCustomerId: subscription.customer ?? null,
            cancelledAt: new Date(),
          },
        ]
      }
      if (!subscription.customer) return []
      return [
        {
          ...base(occurredAt),
          type: "subscription.updated",
          customerEmail: null,
          // The reference is set on the subscription once; each cycle's payment
          // then resolves through the customer it binds.
          attributionToken: readAttributionToken(subscription.externalReference),
          subscription: {
            providerSubscriptionId: subscription.id,
            providerCustomerId: subscription.customer,
            status: "active",
            currency: "BRL",
            amountMinor: subscription.value === null || subscription.value === undefined ? 0 : minor(subscription.value),
            interval: CYCLE[(subscription.cycle ?? "MONTHLY").toUpperCase()] ?? "month",
            startedAt: occurredAt,
            currentPeriodStart: null,
            currentPeriodEnd: null,
            cancelledAt: null,
          },
        },
      ]
    }

    return []
  }

  async connect(input: ConnectInput, http: HttpClient) {
    const environment = asaasEnvironment(input.apiKey)
    if (!environment) throw new ConnectorSetupError("invalid_credentials")

    const response = await http(`${ASAAS_API[environment]}/webhooks`, {
      method: "POST",
      headers: {
        access_token: input.apiKey,
        "content-type": "application/json",
        // Required by Asaas for root accounts created from 2024-06-13 on.
        "user-agent": `${BRAND.name} billing connector`,
      },
      body: JSON.stringify({
        name: `${BRAND.name} affiliate attribution`,
        url: input.webhookUrl,
        ...(input.notifyEmail ? { email: input.notifyEmail } : {}),
        enabled: true,
        interrupted: false,
        apiVersion: 3,
        authToken: input.generatedSecret,
        sendType: "SEQUENTIALLY",
        events: ASAAS_EVENTS,
      }),
    }).catch(() => null)

    if (!response) throw new ConnectorSetupError("provider_unavailable")
    if (response.status === 401 || response.status === 403) throw new ConnectorSetupError("invalid_credentials", response.status)
    if (!response.ok) throw new ConnectorSetupError("webhook_registration_failed", response.status)

    const body = z.object({ id: z.string() }).loose().safeParse(await response.json().catch(() => null))

    return {
      credentials: {
        apiKey: input.apiKey,
        authToken: input.generatedSecret,
        ...(body.success ? { webhookId: body.data.id } : {}),
      },
      environment,
      providerAccountId: null,
      webhookRegistered: true,
    }
  }

  async disconnect(credentials: unknown, http: HttpClient): Promise<boolean> {
    const parsed = credentialsSchema.safeParse(credentials)
    if (!parsed.success || !parsed.data.webhookId) return false
    const environment = asaasEnvironment(parsed.data.apiKey)
    if (!environment) return false
    const response = await http(`${ASAAS_API[environment]}/webhooks/${encodeURIComponent(parsed.data.webhookId)}`, {
      method: "DELETE",
      headers: { access_token: parsed.data.apiKey, "user-agent": `${BRAND.name} billing connector` },
    }).catch(() => null)
    return Boolean(response?.ok)
  }
}
