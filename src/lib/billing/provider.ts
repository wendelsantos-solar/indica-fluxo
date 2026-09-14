import "server-only"

import type { BillingProvider, BillingProviderId } from "./types"
import { StripeAdapter } from "./stripe/adapter"

const registry = new Map<BillingProviderId, BillingProvider>([["stripe", new StripeAdapter()]])

/** Adding Paddle later means one more entry here and one new folder. */
export function billingProvider(id: BillingProviderId): BillingProvider {
  const provider = registry.get(id)
  if (!provider) throw new Error(`Billing provider "${id}" is not available in this build.`)
  return provider
}

export function isSupportedProvider(id: string): id is BillingProviderId {
  return registry.has(id as BillingProviderId)
}
