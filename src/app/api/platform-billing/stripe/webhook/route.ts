import { NextResponse, type NextRequest } from "next/server"

import { platformBillingEnv } from "@/lib/env/server"
import { logger } from "@/lib/logger"
import { platformPrices } from "@/lib/platform-billing/stripe/gateway"
import { verifyPlatformWebhook } from "@/lib/platform-billing/stripe/webhook"
import { ingestPlatformBillingEvent } from "@/server/services/platform-billing"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Refvia's own billing webhook (docs/PLANS.md §5): the endpoint in
 * Refvia's Stripe account, verified with `PLATFORM_STRIPE_WEBHOOK_SECRET`.
 * Never the founders' endpoints under `/api/webhooks/stripe`.
 *
 * Service connection (RLS bypassed) inside `platform-billing` — an ingest path
 * whose caller is Stripe, not a user (ARCHITECTURE.md §2).
 */
export async function POST(request: NextRequest) {
  const config = platformBillingEnv()
  if (!config) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 })
  }

  const signature = request.headers.get("stripe-signature")
  if (!signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 })
  }

  const rawBody = await request.text()

  let event
  try {
    event = await verifyPlatformWebhook(rawBody, signature, config.webhookSecret, platformPrices(config))
  } catch {
    logger.warn("platform billing webhook signature rejected", { provider: "stripe", scope: "platform_billing" })
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 })
  }

  const result = await ingestPlatformBillingEvent(event)
  switch (result.status) {
    case "duplicate":
      return NextResponse.json({ received: true, duplicate: true })
    case "ignored":
      return NextResponse.json({ received: true, ignored: true })
    case "processed":
      return NextResponse.json({ received: true })
    case "failed":
      // 500 asks Stripe to retry; a failed claim is claimable again.
      return NextResponse.json({ error: "processing_failed" }, { status: 500 })
  }
}
