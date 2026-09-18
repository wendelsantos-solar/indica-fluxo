import "server-only"

import Stripe from "stripe"

let cached: { key: string; client: Stripe } | null = null

/**
 * Refvia's OWN Stripe account (`PLATFORM_STRIPE_SECRET_KEY`), used only to
 * charge workspaces for their plan. Not `src/lib/billing/stripe/client.ts`,
 * which reads the founders' billing. The two never share a client or a key —
 * docs/PLANS.md §5. CLAUDE.md rule 6 allows `stripe` only in these two folders.
 */
export function platformStripe(secretKey: string): Stripe {
  if (cached?.key === secretKey) return cached.client
  const client = new Stripe(secretKey, { appInfo: { name: "indica-fluxo-platform-billing" } })
  cached = { key: secretKey, client }
  return client
}
