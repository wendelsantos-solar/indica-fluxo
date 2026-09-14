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

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null
  return typeof value === "string" ? value : value.id
}

export class StripeAdapter implements BillingProvider {
  readonly id = "stripe" as const

  /** Verifies before parsing. An unverified body is never handed to JSON.parse. */
  async verifyWebhook(rawBody: string, signature: string): Promise<VerifiedWebhook> {
    const secret = env().STRIPE_WEBHOOK_SECRET
    if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not configured.")

    const event = await stripe().webhooks.constructEventAsync(rawBody, signature, secret)

    return {
      providerEventId: event.id,
      rawType: event.type,
      providerAccountId: event.account ?? null,
      payload: event,
    }
  }

  normalizeEvent(webhook: VerifiedWebhook): NormalizedBillingEvent | null {
    const event = webhook.payload as Stripe.Event
    const base = {
      provider: "stripe" as const,
      providerEventId: event.id,
      rawType: event.type,
      occurredAt: new Date(event.created * 1000),
      providerAccountId: webhook.providerAccountId,
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
          providerCustomerId: idOf(invoice.customer),
          providerSubscriptionId: idOf(
            (invoice as unknown as { subscription?: string | { id: string } }).subscription,
          ),
          customerEmail: invoice.customer_email ?? null,
          currency: invoice.currency.toUpperCase(),
          amountMinor: invoice.amount_paid,
        }
      }

      case "payment_intent.succeeded": {
        const intent = event.data.object as Stripe.PaymentIntent
        // Subscription revenue arrives as an invoice; this is the one-off path.
        // `invoice` is not on the current typings but is present on the wire.
        const linkedInvoice = (intent as unknown as { invoice?: string | { id: string } }).invoice
        if (linkedInvoice) return null
        return {
          ...base,
          type: "payment.succeeded",
          providerTransactionId: intent.id,
          providerCustomerId: idOf(intent.customer),
          providerSubscriptionId: null,
          customerEmail: intent.receipt_email ?? null,
          currency: intent.currency.toUpperCase(),
          amountMinor: intent.amount_received || intent.amount,
        }
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge
        if (!charge.amount_refunded) return null
        return {
          ...base,
          type: "payment.refunded",
          providerTransactionId: `${charge.id}_refund`,
          providerParentTransactionId:
            idOf((charge as unknown as { invoice?: string | { id: string } }).invoice) ??
            idOf(charge.payment_intent) ??
            charge.id,
          providerCustomerId: idOf(charge.customer),
          currency: charge.currency.toUpperCase(),
          amountMinor: charge.amount_refunded,
          isChargeback: false,
        }
      }

      case "charge.dispute.created": {
        const dispute = event.data.object as Stripe.Dispute
        return {
          ...base,
          type: "payment.refunded",
          providerTransactionId: `${dispute.id}_dispute`,
          providerParentTransactionId: idOf(dispute.charge),
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
