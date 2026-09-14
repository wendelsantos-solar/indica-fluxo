import "server-only"

import Stripe from "stripe"

import { env } from "@/lib/env/server"

let cached: Stripe | null = null

/**
 * The ONLY module allowed to construct a Stripe client. Everything else in the
 * codebase talks to `BillingProvider`. See CLAUDE.md rule 6.
 */
export function stripe(): Stripe {
  if (cached) return cached
  const key = env().STRIPE_SECRET_KEY
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured.")
  cached = new Stripe(key, { appInfo: { name: "indica-fluxo" } })
  return cached
}
