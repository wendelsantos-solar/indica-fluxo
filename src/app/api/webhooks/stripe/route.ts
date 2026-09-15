import { NextResponse, type NextRequest } from "next/server"

import { billingProvider } from "@/lib/billing/provider"
import { logger } from "@/lib/logger"
import {
  ingestVerifiedWebhook,
  workspaceForProviderAccount,
} from "@/server/services/billing-events"

import { ingestResponse } from "./responses"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * LEGACY platform endpoint. Kept for Stripe Connect (events carry
 * `event.account`) and for the local/demo setup that forwards events with the
 * Stripe CLI signed by the one platform-wide `STRIPE_WEBHOOK_SECRET`.
 *
 * A founder's own Stripe endpoint is signed with that endpoint's secret, which
 * this route cannot know — founders use `/api/webhooks/stripe/<integrationId>`
 * instead (DOCS_TECHNICAL_FINDINGS.md T1).
 *
 * Order matters and is the whole point (ARCHITECTURE.md §3.3):
 *   1. read the RAW body — never a parsed one
 *   2. verify the signature before anything touches JSON.parse
 *   3. claim (provider, event id) so a redelivery is a no-op
 *   4. normalise, then hand a provider-free event to the domain
 *
 * Runs on the service connection (via `billing-events`): the caller is Stripe,
 * authenticated by its signature, not a user — ARCHITECTURE.md §2.
 */
export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature")
  if (!signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 })
  }

  const rawBody = await request.text()
  const stripe = billingProvider("stripe")

  let verified
  try {
    verified = await stripe.verifyWebhook(rawBody, signature)
  } catch {
    // Never echo the reason: it tells a prober how close they got.
    logger.warn("stripe webhook signature rejected", { provider: "stripe" })
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 })
  }

  const workspaceId = await workspaceForProviderAccount("stripe", verified.providerAccountId)
  const result = await ingestVerifiedWebhook({ provider: stripe, verified, rawBody, workspaceId })

  return ingestResponse(result)
}
