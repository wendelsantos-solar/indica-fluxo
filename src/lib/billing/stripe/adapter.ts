import "server-only"

import type Stripe from "stripe"

import { env } from "@/lib/env/server"
import type {
  BillingProvider,
  NormalizedBillingEvent,
  ProviderAccount,
  ProviderCustomer,
  ProviderSubscription,
  VerifiedWebhook,
} from "@/lib/billing/types"

import { stripe } from "./client"
import { verifyStripeWebhook } from "./webhook"

const INTERVAL_MAP: Record<string, ProviderSubscription["interval"]> = {
  day: "day",
  week: "week",
  month: "month",
  year: "year",
}

const STATUS_MAP: Record<string, ProviderSubscription["status"]> = {
  trialing: "trialing",
  active: "active",
  past_due: "past_due",
  unpaid: "past_due",
  canceled: "cancelled",
  incomplete: "incomplete",
  incomplete_expired: "incomplete",
  paused: "cancelled",
}

function seconds(value: number | null | undefined): Date | null {
  return typeof value === "number" ? new Date(value * 1000) : null
}

function idOf(value: string | { id?: string } | null | undefined): string | null {
  if (!value) return null
  return typeof value === "string" ? value : (value.id ?? null)
}

function compact(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

/**
 * The PaymentIntents and charges that paid an invoice, when the payload holds
 * them: `payments` is only present if expanded, and pre-basil invoices carried
 * `payment_intent` / `charge` directly. Otherwise `invoice_payment.paid`
 * supplies the link.
 */
function invoicePaymentReferences(invoice: Stripe.Invoice): string[] {
  const legacy = invoice as unknown as { payment_intent?: string | { id: string }; charge?: string | { id: string } }
  const fromPayments = (invoice.payments?.data ?? []).flatMap((payment) => [
    idOf(payment.payment?.payment_intent),
    idOf(payment.payment?.charge),
  ])
  return compact([idOf(legacy.payment_intent), idOf(legacy.charge), ...fromPayments])
}

function subscriptionOfInvoice(invoice: Stripe.Invoice): string | null {
  const legacy = (invoice as unknown as { subscription?: string | { id: string } }).subscription
  return idOf(legacy) ?? idOf(invoice.parent?.subscription_details?.subscription)
}

export class StripeAdapter implements BillingProvider {
  readonly id = "stripe" as const

  /**
   * Legacy platform endpoint: verifies with the one platform-wide secret.
   * Per-workspace endpoints call `verifyStripeWebhook` with their own secret.
   * Verifies before parsing. An unverified body is never handed to JSON.parse.
   */
  async verifyWebhook(rawBody: string, signature: string): Promise<VerifiedWebhook> {
    const secret = env().STRIPE_WEBHOOK_SECRET
    if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not configured.")
    return verifyStripeWebhook(rawBody, signature, secret)
  }

  normalizeEvent(webhook: VerifiedWebhook): NormalizedBillingEvent | null {
    const event = webhook.payload as Stripe.Event
    const base = {
      provider: "stripe" as const,
      providerEventId: event.id,
      rawType: event.type,
      occurredAt: new Date(event.created * 1000),
      providerAccountId: webhook.providerAccountId,
      // Stripe's own flag decides the ledger. A per-integration endpoint has
      // already checked it against the secret that verified the delivery.
      environment: event.livemode === true ? ("live" as const) : ("test" as const),
    }

    switch (event.type) {
      case "invoice.payment_succeeded":
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice
        if (!invoice.amount_paid) return null
        return {
          ...base,
          type: "payment.succeeded",
          providerTransactionId: invoice.id ?? `invoice_${event.id}`,
          providerReferences: invoicePaymentReferences(invoice),
          providerCustomerId: idOf(invoice.customer),
          providerSubscriptionId: subscriptionOfInvoice(invoice),
          customerEmail: invoice.customer_email ?? null,
          currency: invoice.currency.toUpperCase(),
          amountMinor: invoice.amount_paid,
        }
      }

      case "invoice_payment.paid": {
        // Since API 2025-03-31.basil an invoice no longer names its
        // PaymentIntent or charge; this object is the link. It carries no money.
        const payment = event.data.object as Stripe.InvoicePayment
        const invoiceId = idOf(payment.invoice)
        const references = compact([idOf(payment.payment.payment_intent), idOf(payment.payment.charge)])
        if (!invoiceId || references.length === 0) return null
        return {
          ...base,
          type: "payment.referenced",
          providerTransactionId: invoiceId,
          providerReferences: references,
        }
      }

      case "payment_intent.succeeded": {
        const intent = event.data.object as Stripe.PaymentIntent
        // Subscription revenue arrives as an invoice; this is the one-off path.
        // `invoice` is only on the wire for API versions before basil. From
        // basil on (dahlia included) neither the PaymentIntent nor its charge
        // names an invoice, so the service reconciles the two through
        // `invoice_payment.paid` (billing-events.ts, "one payment, one commission").
        const linkedInvoice = (intent as unknown as { invoice?: string | { id: string } }).invoice
        if (linkedInvoice) return null
        return {
          ...base,
          type: "payment.succeeded",
          providerTransactionId: intent.id,
          providerReferences: compact([idOf(intent.latest_charge)]),
          providerCustomerId: idOf(intent.customer),
          providerSubscriptionId: null,
          customerEmail: intent.receipt_email ?? null,
          currency: intent.currency.toUpperCase(),
          amountMinor: intent.amount_received || intent.amount,
        }
      }

      case "refund.created": {
        // One event per refund, partial ones included, with the refund's own
        // amount — `charge.refunded` only carries the charge's running total.
        const refund = event.data.object as Stripe.Refund
        if (!refund.amount || refund.status === "failed" || refund.status === "canceled") return null
        const references = compact([
          idOf(refund.payment_intent),
          idOf(refund.charge),
          // Pre-basil charges still name their invoice.
          idOf((refund.charge as unknown as { invoice?: string | { id: string } } | null)?.invoice),
        ])
        if (references.length === 0) return null
        return {
          ...base,
          type: "payment.refunded",
          providerTransactionId: refund.id,
          paymentReferences: references,
          providerCustomerId: idOf(refund.customer),
          currency: refund.currency.toUpperCase(),
          amountMinor: refund.amount,
          isChargeback: false,
        }
      }

      case "charge.dispute.created": {
        const dispute = event.data.object as Stripe.Dispute
        return {
          ...base,
          type: "payment.refunded",
          providerTransactionId: dispute.id,
          paymentReferences: compact([idOf(dispute.payment_intent), idOf(dispute.charge)]),
          providerCustomerId: null,
          currency: dispute.currency.toUpperCase(),
          amountMinor: dispute.amount,
          isChargeback: true,
        }
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription
        return {
          ...base,
          type: "subscription.updated",
          subscription: this.mapSubscription(subscription),
          customerEmail: null,
        }
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription
        return {
          ...base,
          type: "subscription.cancelled",
          providerSubscriptionId: subscription.id,
          providerCustomerId: idOf(subscription.customer),
          cancelledAt: seconds(subscription.canceled_at) ?? base.occurredAt,
        }
      }

      default:
        return null
    }
  }

  private mapSubscription(subscription: Stripe.Subscription): ProviderSubscription {
    const item = subscription.items.data[0]
    const price = item?.price
    const recurring = price?.recurring

    return {
      providerSubscriptionId: subscription.id,
      providerCustomerId: idOf(subscription.customer) ?? "",
      status: STATUS_MAP[subscription.status] ?? "incomplete",
      currency: (price?.currency ?? "usd").toUpperCase(),
      amountMinor: (price?.unit_amount ?? 0) * (item?.quantity ?? 1),
      interval: recurring ? (INTERVAL_MAP[recurring.interval] ?? "month") : "one_time",
      startedAt: seconds(subscription.start_date) ?? new Date(),
      currentPeriodStart: seconds(item?.current_period_start),
      currentPeriodEnd: seconds(item?.current_period_end),
      cancelledAt: seconds(subscription.canceled_at),
    }
  }

  async getCustomer(
    providerAccountId: string,
    providerCustomerId: string,
  ): Promise<ProviderCustomer | null> {
    const customer = await stripe().customers.retrieve(
      providerCustomerId,
      {},
      { stripeAccount: providerAccountId },
    )
    if (customer.deleted) return null

    return {
      providerCustomerId: customer.id,
      email: customer.email ?? undefined,
      externalId: customer.metadata?.external_id,
      createdAt: new Date(customer.created * 1000),
    }
  }

  async getSubscription(
    providerAccountId: string,
    providerSubscriptionId: string,
  ): Promise<ProviderSubscription | null> {
    const subscription = await stripe().subscriptions.retrieve(
      providerSubscriptionId,
      {},
      { stripeAccount: providerAccountId },
    )
    return this.mapSubscription(subscription)
  }

  buildConnectUrl({ state, redirectUri }: { state: string; redirectUri: string }): string {
    const clientId = env().STRIPE_CONNECT_CLIENT_ID
    if (!clientId) throw new Error("STRIPE_CONNECT_CLIENT_ID is not configured.")

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      scope: "read_only",
      redirect_uri: redirectUri,
      state,
    })
    return `https://connect.stripe.com/oauth/authorize?${params.toString()}`
  }

  async exchangeConnectCode(code: string): Promise<ProviderAccount> {
    const response = await stripe().oauth.token({ grant_type: "authorization_code", code })
    if (!response.stripe_user_id) throw new Error("Stripe did not return a connected account id.")
    return { providerAccountId: response.stripe_user_id }
  }
}
