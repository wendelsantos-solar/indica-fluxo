import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { billingProvider } from "@/lib/billing/provider"
import { verifyStripeWebhook } from "@/lib/billing/stripe/webhook"
import { logger } from "@/lib/logger"
import { ingestVerifiedWebhook } from "@/server/services/billing-events"
import {
  recordWebhookRejection,
  webhookTargetForIntegration,
} from "@/server/services/integrations"

import { ingestResponse } from "../responses"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const paramsSchema = z.object({ integrationId: z.uuid() })

/**
 * Per-workspace Stripe endpoint: the URL a founder adds in their own Stripe
 * dashboard, verified with that endpoint's own signing secret
 * (DOCS_TECHNICAL_FINDINGS.md T1).
 *
 * The workspace comes from the integration this URL names — never from
 * `event.account`, which Stripe only sets for Connect. The signing secret is
 * the proof: only the owner of that Stripe endpoint can produce a valid
 * signature for this integration.
 *
 * Service connection (RLS bypassed) via `integrations` and `billing-events`:
 * an ingest path whose caller is Stripe, not a user — ARCHITECTURE.md §2.
 * Every failure before verification answers with a bare code, so a prober
 * learns nothing about which integration ids exist.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ integrationId: string }> },
) {
  const parsed = paramsSchema.safeParse(await params)
  if (!parsed.success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }

  const signature = request.headers.get("stripe-signature")
  if (!signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 })
  }

  const { integrationId } = parsed.data
  const target = await webhookTargetForIntegration(integrationId)
  // Unknown id, another provider, or no secret saved yet: indistinguishable.
  if (!target) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }

  const rawBody = await request.text()

  let verified
  try {
    verified = await verifyStripeWebhook(rawBody, signature, target.webhookSecret)
  } catch {
    // Never echo the reason: it tells a prober how close they got. The
    // founder does see *that* a delivery was rejected, on Integrations.
    logger.warn("stripe webhook signature rejected", {
      provider: "stripe",
      workspaceId: target.workspaceId,
    })
    await recordWebhookRejection(integrationId)
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 })
  }

  const result = await ingestVerifiedWebhook({
    provider: billingProvider("stripe"),
    verified,
    rawBody,
    workspaceId: target.workspaceId,
  })

  return ingestResponse(result)
}
