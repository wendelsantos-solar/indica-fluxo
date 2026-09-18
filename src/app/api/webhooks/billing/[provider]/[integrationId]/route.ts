import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { WebhookAuthError, type WebhookDelivery } from "@/lib/billing/connector"
import { billingConnector, isApiConnectorId } from "@/lib/billing/connectors"
import { logger } from "@/lib/logger"
import { ingestVerifiedWebhook } from "@/server/services/billing-events"
import {
  connectionWebhookTarget,
  noteConnectionAccount,
  recordConnectionRejection,
} from "@/server/services/billing-connections"

import { ingestResponse } from "../../../stripe/responses"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const paramsSchema = z.object({ provider: z.string(), integrationId: z.uuid() })

/**
 * One endpoint for every non-Stripe billing connector
 * (UNIVERSAL_ATTRIBUTION_ARCHITECTURE.md §7):
 * `/api/webhooks/billing/<provider>/<connection id>`.
 *
 * The connection comes from the URL and must belong to the named provider; its
 * own credentials authenticate the delivery (Mercado Pago's HMAC, AbacatePay's
 * secret + HMAC, Asaas's token), through its connector, before anything is
 * trusted. The workspace and environment come from the connection — never from
 * the payload.
 *
 * Every failure before authentication answers with a bare code, so a prober
 * learns nothing about which connections exist. AbacatePay disables a webhook
 * that answers 410, so no path here ever does. The query string may carry a
 * secret (AbacatePay `webhookSecret`); the URL is never logged.
 *
 * Service connection (RLS bypassed) via `billing-connections` and
 * `billing-events`: the caller is the provider, not a user — ARCHITECTURE.md §2.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string; integrationId: string }> },
) {
  const parsed = paramsSchema.safeParse(await params)
  if (!parsed.success || !isApiConnectorId(parsed.data.provider)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }
  const { provider, integrationId } = parsed.data
  if (!isApiConnectorId(provider)) return NextResponse.json({ error: "not_found" }, { status: 404 })

  // Unknown id, another provider, disabled connector, no credentials: indistinguishable.
  const target = await connectionWebhookTarget(provider, integrationId)
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 })

  const rawBody = await request.text()
  const delivery: WebhookDelivery = {
    rawBody,
    header: (name) => request.headers.get(name),
    query: request.nextUrl.searchParams,
  }
  const connector = billingConnector(provider)

  let verified
  try {
    verified = await connector.verify(delivery, target.credentials)
  } catch (error) {
    logger.warn("billing webhook rejected", {
      provider,
      workspaceId: target.workspaceId,
      integrationId,
      reason: error instanceof WebhookAuthError ? error.code : "unknown",
    })
    await recordConnectionRejection(integrationId)
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 })
  }

  // A verified delivery from a different provider account than the one this
  // connection learned is not this connection's to process.
  if (verified.providerAccountId) {
    if (target.providerAccountId && target.providerAccountId !== verified.providerAccountId) {
      logger.warn("billing webhook for another account on this connection", { provider, integrationId })
      return NextResponse.json({ received: true, ignored: "account_mismatch" })
    }
    if (!target.providerAccountId) await noteConnectionAccount(integrationId, verified.providerAccountId)
  }

  const result = await ingestVerifiedWebhook({
    provider: { id: provider },
    verified,
    rawBody,
    workspaceId: target.workspaceId,
    integrationId,
    connectionEnvironment: target.environment,
    normalize: () =>
      connector.normalize(verified, {
        credentials: target.credentials,
        environment: target.environment,
        http: fetch,
      }),
  })

  return ingestResponse(result)
}
