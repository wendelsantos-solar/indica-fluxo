import "server-only"

import Stripe from "stripe"

import { hashPayload } from "@/lib/crypto/hash"

import { interpretPlatformEvent } from "./normalize"
import type { PlatformBillingEvent, PlatformPrices } from "./types"

/**
 * Verifies a delivery to `/api/platform-billing/stripe/webhook` against
 * `PLATFORM_STRIPE_WEBHOOK_SECRET` before the body is parsed, then turns it
 * into a provider-free `PlatformBillingEvent`. Signature checks are local HMAC
 * work: no API call is made here.
 *
 * Throws when the signature, the timestamp tolerance or the payload is wrong.
 */
export async function verifyPlatformWebhook(
  rawBody: string,
  signature: string,
  secret: string,
  prices: PlatformPrices,
): Promise<PlatformBillingEvent> {
  const event = await Stripe.webhooks.constructEventAsync(rawBody, signature, secret)

  return {
    providerEventId: event.id,
    eventType: event.type,
    createdAt: new Date(event.created * 1000),
    environment: event.livemode ? "live" : "test",
    payloadHash: hashPayload(rawBody),
    action: interpretPlatformEvent(event, prices),
  }
}
