import "server-only"

import { eq, sql } from "drizzle-orm"

import { type DbClient } from "@/server/db"
import { webhookEvents } from "@/server/db/schema"

/**
 * The idempotency gate for every provider webhook (CLAUDE.md rule 8), shared by
 * customer billing and platform billing. `webhook_events` is ingest-only: call
 * these on the service connection, from a provider-authenticated path.
 */

export interface ClaimWebhookEventInput {
  scope: "customer_billing" | "platform_billing"
  provider: "stripe" | "paddle" | "manual"
  providerEventId: string
  eventType: string
  payloadHash: string
  workspaceId: string | null
  environment: "test" | "live" | null
}

/**
 * Claims a provider event for processing.
 *
 *   INSERT … ON CONFLICT (scope, provider, provider_event_id)
 *   DO UPDATE SET status = 'received', … WHERE webhook_events.status = 'failed'
 *   RETURNING id
 *
 * `claimed: true` for a new event, and for a redelivery of one whose earlier
 * processing FAILED — that is what lets a provider's retry actually retry.
 * `claimed: false` for a duplicate of an event already received, processed or
 * ignored: acknowledge it and do nothing.
 */
export async function claimWebhookEvent(
  tx: DbClient,
  input: ClaimWebhookEventInput,
): Promise<{ claimed: boolean; id: string | null }> {
  const [row] = await tx
    .insert(webhookEvents)
    .values({
      scope: input.scope,
      provider: input.provider,
      providerEventId: input.providerEventId,
      eventType: input.eventType,
      payloadHash: input.payloadHash,
      workspaceId: input.workspaceId,
      environment: input.environment,
      status: "received",
    })
    .onConflictDoUpdate({
      target: [webhookEvents.scope, webhookEvents.provider, webhookEvents.providerEventId],
      set: { status: "received", errorMessage: null, processedAt: null, receivedAt: sql`now()` },
      setWhere: sql`${webhookEvents.status} = 'failed'`,
    })
    .returning({ id: webhookEvents.id })

  return row ? { claimed: true, id: row.id } : { claimed: false, id: null }
}

/** Records how a claimed event ended. `failed` makes the next redelivery claimable again. */
export async function markWebhookEvent(
  tx: DbClient,
  id: string,
  status: "processed" | "failed" | "ignored",
  errorMessage?: string,
): Promise<void> {
  await tx
    .update(webhookEvents)
    .set({ status, processedAt: new Date(), errorMessage: errorMessage?.slice(0, 500) ?? null })
    .where(eq(webhookEvents.id, id))
}
