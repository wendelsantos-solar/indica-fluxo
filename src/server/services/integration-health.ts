import "server-only"

import { and, eq, max, sql } from "drizzle-orm"

import { withUser } from "@/server/db"
import { integrations, programs, referralClicks } from "@/server/db/schema"
import { requireMembership } from "@/server/policies/workspace"

/**
 * Evidence that the integrations work, not just that they were configured:
 * "Stripe" is only done once an event has actually arrived.
 */
export interface IntegrationHealth {
  stripe: {
    configured: boolean
    secretSaved: boolean
    lastEventAt: Date | null
    lastEventType: string | null
    lastEventFailed: boolean
  }
  tracking: { lastClickAt: Date | null }
}

interface LatestWebhookEventRow extends Record<string, unknown> {
  received_at: Date | string
  event_type: string
  status: "received" | "processed" | "failed" | "ignored"
}

export async function getIntegrationHealth(userId: string, workspaceId: string): Promise<IntegrationHealth> {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId)

    const [integration] = await tx
      .select({
        status: integrations.status,
        secretSaved: sql<boolean>`${integrations.encryptedCredentials} is not null`,
      })
      .from(integrations)
      .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, "stripe")))
      .limit(1)

    // referral_clicks is readable by workspace members under RLS.
    const [clicks] = await tx
      .select({ lastClickAt: max(referralClicks.occurredAt) })
      .from(referralClicks)
      .innerJoin(programs, eq(programs.id, referralClicks.programId))
      .where(eq(programs.workspaceId, workspaceId))

    // `webhook_events` itself stays closed to `authenticated` (migration 0001
    // §10). `latest_webhook_event` (migration 0007) is a SECURITY DEFINER
    // function that returns only the time, type and outcome of the latest
    // event, and nothing at all to a non-member. See DATABASE.md §6.
    const events = await tx.execute<LatestWebhookEventRow>(
      sql`select received_at, event_type, status from public.latest_webhook_event(${workspaceId})`,
    )
    const lastEvent = events[0]
    const lastClickAt = clicks?.lastClickAt ?? null

    return {
      stripe: {
        configured: integration?.status === "connected",
        secretSaved: integration?.secretSaved ?? false,
        lastEventAt: lastEvent ? new Date(lastEvent.received_at) : null,
        lastEventType: lastEvent?.event_type ?? null,
        lastEventFailed: lastEvent?.status === "failed",
      },
      tracking: { lastClickAt: lastClickAt ? new Date(lastClickAt) : null },
    }
  })
}
