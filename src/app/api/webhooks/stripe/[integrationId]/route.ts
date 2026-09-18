import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { billingProvider } from "@/lib/billing/provider"
import { StripeLivemodeMismatchError, verifyStripeWebhookWithSecrets } from "@/lib/billing/stripe/webhook"
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
 * dashboard — once in test mode, once in live mode — verified with that
 * endpoint's own signing secret (DOCS_TECHNICAL_FINDINGS.md T1). The event's
 * `livemode` routes it to test or live programs (docs/PLANS.md §2).
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
    // Tried against the test and the live endpoint secrets; the one that
    // verifies must agree with the event's own `livemode`.
    verified = await verifyStripeWebhookWithSecrets(rawBody, signature, target.secrets)
  } catch (error) {
    const mismatch = error instanceof StripeLivemodeMismatchError
    const unconfigured = !mismatch ? unconfiguredEnvironment(rawBody, target.secrets) : null
    if (unconfigured) {
      // A delivery for a mode whose secret is not saved yet — typically the live
      // endpoint created before its secret was pasted. Not a wrong secret, so it
      // must not turn the panel red. Still non-2xx: Stripe keeps retrying, and
      // the retries go through once the secret is saved.
      logger.info("stripe webhook for a mode without a saved secret", {
        provider: "stripe",
        workspaceId: target.workspaceId,
        environment: unconfigured,
      })
      return NextResponse.json({ error: "invalid_signature" }, { status: 400 })
    }
    // Never echo the reason: it tells a prober how close they got. The
    // founder does see *that* a delivery was rejected, on Integrations.
    logger.warn(mismatch ? "stripe webhook livemode does not match its secret" : "stripe webhook signature rejected", {
      provider: "stripe",
      workspaceId: target.workspaceId,
    })
    await recordWebhookRejection(integrationId)
    return NextResponse.json({ error: mismatch ? "livemode_mismatch" : "invalid_signature" }, { status: 400 })
  }

  const result = await ingestVerifiedWebhook({
    provider: billingProvider("stripe"),
    verified,
    rawBody,
    workspaceId: target.workspaceId,
    integrationId,
  })

  return ingestResponse(result)
}

const livemodeSchema = z.object({ livemode: z.boolean() })

/**
 * The mode an unverified delivery claims, when this integration has no secret
 * for it. Read only to decide how to label a rejection — never to trust the
 * event: nothing from an unverified body is processed.
 */
function unconfiguredEnvironment(
  rawBody: string,
  secrets: { test: string | null; live: string | null },
): "test" | "live" | null {
  let json: unknown
  try {
    json = JSON.parse(rawBody)
  } catch {
    return null
  }
  const parsed = livemodeSchema.safeParse(json)
  if (!parsed.success) return null
  const environment = parsed.data.livemode ? "live" : "test"
  return secrets[environment] ? null : environment
}
