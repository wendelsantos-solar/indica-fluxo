import "server-only"

import { eq, sql } from "drizzle-orm"

import type { BillingProviderId } from "@/lib/billing/types"
import type { ReasonCode } from "@/lib/billing/reasons"
import { type DbClient } from "@/server/db"
import { webhookEvents } from "@/server/db/schema"

/**
 * The idempotency gate for every provider webhook (CLAUDE.md rule 8), shared by
 * customer billing and platform billing. `webhook_events` is ingest-only: call
 * these on the service connection, from a provider-authenticated path.
 */

export interface ClaimWebhookEventInput {
  scope: "customer_billing" | "platform_billing"
  provider: BillingProviderId
  providerEventId: string
  eventType: string
  payloadHash: string
  workspaceId: string | null
  environment: "test" | "live" | null
  /** The billing connection it arrived on (migration 0018). */
  integrationId?: string | null
}

/**
 * Claims a provider event for processing.
 *
 *   INSERT … ON CONFLICT (scope, provider, provider_event_id)
 *   DO UPDATE SET status = 'received', … WHERE webhook_events.status = 'failed'
 *   RETURNING id
 *
 * `claimed: true` for a new event, for a redelivery of one whose earlier
 * processing FAILED — that is what lets a provider's retry actually retry — and
 * for a redelivery of one stuck in `received` for longer than any processing
 * takes. The claim commits on its own, before processing; a process killed in
 * between (timeout, deploy) would otherwise leave the event claimed forever and
 * every retry acknowledged as a duplicate. Processing is idempotent on its own
 * keys, so reclaiming a slow-but-alive claim cannot double a commission.
 * `claimed: false` for a duplicate of an event already received, processed or
 * ignored: acknowledge it and do nothing.
 */
/** Longer than any webhook processing can take (Stripe gives up on a delivery after ~20s). */
export const STALE_CLAIM_MINUTES = 10

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
      integrationId: input.integrationId ?? null,
      status: "received",
    })
    .onConflictDoUpdate({
      target: [webhookEvents.scope, webhookEvents.provider, webhookEvents.providerEventId],
      set: { status: "received", errorMessage: null, reasonCode: null, processedAt: null, receivedAt: sql`now()` },
      setWhere: sql`${webhookEvents.status} = 'failed'
        or (${webhookEvents.status} = 'received'
            and ${webhookEvents.receivedAt} < now() - make_interval(mins => ${STALE_CLAIM_MINUTES}))`,
    })
    .returning({ id: webhookEvents.id })

  return row ? { claimed: true, id: row.id } : { claimed: false, id: null }
}

/**
 * Records how a claimed event ended. `failed` makes the next redelivery
 * claimable again. `reasonCode` is from the closed list in
 * `src/lib/billing/reasons.ts` — what diagnostics group by; `errorMessage` keeps
 * the free text (and the exact string migration 0015 counts).
 */
export async function markWebhookEvent(
  tx: DbClient,
  id: string,
  status: "processed" | "failed" | "ignored",
  errorMessage?: string,
  reasonCode?: ReasonCode,
): Promise<void> {
  await tx
    .update(webhookEvents)
    .set({
      status,
      processedAt: new Date(),
      errorMessage: errorMessage?.slice(0, 500) ?? null,
      reasonCode: reasonCode ?? null,
    })
    .where(eq(webhookEvents.id, id))
}
