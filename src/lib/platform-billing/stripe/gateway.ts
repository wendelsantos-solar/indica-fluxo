import "server-only"

import type Stripe from "stripe"

import { platformBillingEnv, type PlatformBillingEnv } from "@/lib/env/server"

import { platformStripe } from "./client"
import { normalizeSubscription } from "./normalize"
import type { PlatformBillingGateway, PlatformPrices } from "./types"

/** Stripe's hosted pages speak these; anything else lets Stripe negotiate. */
function stripeLocale(locale: string): "pt-BR" | "en" | "auto" {
  if (locale === "pt-br") return "pt-BR"
  if (locale === "en") return "en"
  return "auto"
}

export function platformPrices(config: Pick<PlatformBillingEnv, "launchPriceId" | "growthPriceId">): PlatformPrices {
  return { launch: config.launchPriceId, growth: config.growthPriceId }
}

/** Builds the gateway over a Stripe client. Exported for tests, which pass a fake client. */
export function createPlatformBillingGateway(client: Stripe, prices: PlatformPrices): PlatformBillingGateway {
  return {
    prices,

    async retrieveSubscription(subscriptionId, eventCreatedAt) {
      const subscription = await client.subscriptions.retrieve(subscriptionId)
      return normalizeSubscription(subscription, prices, eventCreatedAt)
    },

    async createCheckoutSession(input) {
      const metadata = { workspace_id: input.workspaceId }
      const session = await client.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: input.priceId, quantity: 1 }],
        client_reference_id: input.workspaceId,
        metadata,
        // Copied onto the subscription, so every later event names the workspace.
        subscription_data: { metadata },
        ...(input.customerId
          ? { customer: input.customerId }
          : input.customerEmail
            ? { customer_email: input.customerEmail }
            : {}),
        locale: stripeLocale(input.locale),
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      })
      if (!session.url) throw new Error("Stripe returned a checkout session without a URL.")
      return { url: session.url }
    },

    async createPortalSession(input) {
      let flowData: Stripe.BillingPortal.SessionCreateParams.FlowData | undefined
      if (input.change) {
        const subscription = await client.subscriptions.retrieve(input.change.subscriptionId)
        const items = subscription.items.data
        // The confirm flow updates exactly one item; IndicaFluxo sells one per subscription.
        if (items.length !== 1) {
          throw new Error(`Subscription has ${items.length} items; a plan change needs exactly one.`)
        }
        flowData = {
          type: "subscription_update_confirm",
          subscription_update_confirm: {
            subscription: subscription.id,
            items: [{ id: items[0]!.id, price: input.change.priceId, quantity: 1 }],
          },
          after_completion: { type: "redirect", redirect: { return_url: input.returnUrl } },
        }
      }

      const session = await client.billingPortal.sessions.create({
        customer: input.customerId,
        return_url: input.returnUrl,
        locale: stripeLocale(input.locale),
        ...(flowData ? { flow_data: flowData } : {}),
      })
      return { url: session.url }
    },
  }
}

/** The configured gateway, or `null` when platform billing is not set up. */
export function platformBillingGateway(): PlatformBillingGateway | null {
  const config = platformBillingEnv()
  if (!config) return null
  return createPlatformBillingGateway(platformStripe(config.secretKey), platformPrices(config))
}
