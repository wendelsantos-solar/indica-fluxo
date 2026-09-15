import "server-only"

import Stripe from "stripe"

import type { VerifiedWebhook } from "@/lib/billing/types"

/**
 * Verifies a Stripe delivery against one endpoint's signing secret, before the
 * body is ever parsed. Signature checks are local HMAC work, so the static
 * helper is used: no API key is needed to verify, and a founder's endpoint
 * does not depend on the platform's `STRIPE_SECRET_KEY` being set.
 *
 * Throws when the signature, the timestamp tolerance or the payload is wrong.
 */
export async function verifyStripeWebhook(
  rawBody: string,
  signature: string,
  secret: string,
): Promise<VerifiedWebhook> {
  const event = await Stripe.webhooks.constructEventAsync(rawBody, signature, secret)

  return {
    providerEventId: event.id,
    rawType: event.type,
    providerAccountId: event.account ?? null,
    payload: event,
  }
}
