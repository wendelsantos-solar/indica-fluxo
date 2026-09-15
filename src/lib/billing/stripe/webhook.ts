import "server-only"

import Stripe from "stripe"

import type { BillingEnvironment, VerifiedWebhook } from "@/lib/billing/types"

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
    environment: event.livemode ? "live" : "test",
    payload: event,
  }
}

/** The signing secrets one integration holds: its Stripe test endpoint's and its live endpoint's. */
export interface StripeEndpointSecrets {
  test: string | null
  live: string | null
}

/** No saved secret verified the signature. */
export class StripeSignatureError extends Error {
  constructor() {
    super("stripe signature did not verify")
    this.name = "StripeSignatureError"
  }
}

/**
 * The signature verified, but with the secret of the other mode: a test-mode
 * event signed by the live endpoint's secret (or the reverse). Stripe never
 * does that, so the secrets were pasted into the wrong fields — or someone is
 * replaying a test event against live processing.
 */
export class StripeLivemodeMismatchError extends Error {
  constructor(readonly verifiedWith: BillingEnvironment) {
    super("stripe event livemode does not match the secret that verified it")
    this.name = "StripeLivemodeMismatchError"
  }
}

/**
 * Verifies a delivery against every secret the integration holds. The secret
 * that verifies decides the environment the founder configured it for, and
 * the event's own `livemode` must agree with it: a live event is only ever
 * accepted through the live endpoint's secret, so test traffic can never be
 * processed as live money (docs/PLANS.md §2).
 */
export async function verifyStripeWebhookWithSecrets(
  rawBody: string,
  signature: string,
  secrets: StripeEndpointSecrets,
): Promise<VerifiedWebhook> {
  for (const environment of ["live", "test"] as const) {
    const secret = secrets[environment]
    if (!secret) continue

    let verified: VerifiedWebhook
    try {
      verified = await verifyStripeWebhook(rawBody, signature, secret)
    } catch {
      continue
    }

    if (verified.environment !== environment) throw new StripeLivemodeMismatchError(environment)
    return verified
  }

  throw new StripeSignatureError()
}
