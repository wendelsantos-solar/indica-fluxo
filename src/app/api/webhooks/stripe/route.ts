import { NextResponse, type NextRequest } from "next/server"

import { billingProvider } from "@/lib/billing/provider"
import { logger } from "@/lib/logger"
import {
  claimWebhookEvent,
  finishWebhookEvent,
  handleBillingEvent,
  workspaceForProviderAccount,
} from "@/server/services/billing-events"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Order matters and is the whole point (ARCHITECTURE.md §3.3):
 *   1. read the RAW body — never a parsed one
 *   2. verify the signature before anything touches JSON.parse
 *   3. claim (provider, event id) so a redelivery is a no-op
 *   4. normalise, then hand a provider-free event to the domain
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

  const log = logger.child({
    provider: "stripe",
    eventId: verified.providerEventId,
  })

  const workspaceId = await workspaceForProviderAccount("stripe", verified.providerAccountId)

  const webhookEventId = await claimWebhookEvent({
    provider: "stripe",
    providerEventId: verified.providerEventId,
    eventType: verified.rawType,
    rawBody,
    workspaceId,
  })

  // Already claimed by an earlier delivery — acknowledge and stop.
  if (!webhookEventId) {
    log.info("duplicate webhook ignored")
    return NextResponse.json({ received: true, duplicate: true })
  }

  if (!workspaceId) {
    await finishWebhookEvent(webhookEventId, "ignored", "no workspace for connected account")
    log.warn("webhook for an unconnected account")
    return NextResponse.json({ received: true, ignored: true })
  }

  const normalized = stripe.normalizeEvent(verified)
  if (!normalized) {
    await finishWebhookEvent(webhookEventId, "ignored", `unhandled type ${verified.rawType}`)
    return NextResponse.json({ received: true, ignored: true })
  }

  try {
    const outcome = await handleBillingEvent(workspaceId, normalized)
    await finishWebhookEvent(
      webhookEventId,
      outcome.status === "ignored" ? "ignored" : "processed",
      outcome.status === "ignored" ? outcome.reason : undefined,
    )

    log.info("webhook processed", { workspaceId, outcome: outcome.status })
    return NextResponse.json({ received: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error"
    await finishWebhookEvent(webhookEventId, "failed", message)
    log.error("webhook processing failed", { workspaceId, error })

    // 500 asks Stripe to retry; the claim row records why it failed.
    return NextResponse.json({ error: "processing_failed" }, { status: 500 })
  }
}
