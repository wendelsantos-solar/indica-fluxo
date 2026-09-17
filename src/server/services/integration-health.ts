import "server-only"

import { and, eq, max, notLike, sql } from "drizzle-orm"

import { withUser, type Transaction } from "@/server/db"
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
    /** The latest event of each Stripe mode, from the founder's test and live endpoints. */
    environments: Record<"test" | "live", EnvironmentEvidence>
  }
  tracking: { lastClickAt: Date | null }
}

export interface EnvironmentEvidence {
  lastEventAt: Date | null
  /** `null` when only derived from the ledger (see `environmentEvidence`). */
  lastEventType: string | null
  lastEventFailed: boolean
  /**
   * `true` when read from the webhook events themselves. `false` when derived
   * from the latest transaction recorded in that environment, which misses
   * events that recorded no money and failures.
   */
  exact: boolean
}

interface LatestWebhookEventRow extends Record<string, unknown> {
  received_at: Date | string
  event_type: string
  status: "received" | "processed" | "failed" | "ignored"
}

export async function getIntegrationHealth(userId: string, workspaceId: string): Promise<IntegrationHealth> {
  return withUser(userId, async (tx) => {
    // Authorise first; the reads below go out together (pipelined on this connection).
    await requireMembership(tx, workspaceId, userId)

    const [[integration], [clicks], { rows: events }, environments] = await Promise.all([
      tx
        .select({
          status: integrations.status,
          secretSaved: sql<boolean>`${integrations.encryptedCredentials} is not null`,
        })
        .from(integrations)
        .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, "stripe")))
        .limit(1),

      // referral_clicks is readable by workspace members under RLS. Simulated
      // clicks (`v_sim…`, src/server/services/sandbox.ts) prove nothing about the
      // tracker being installed, so they don't count.
      tx
        .select({ lastClickAt: max(referralClicks.occurredAt) })
        .from(referralClicks)
        .innerJoin(programs, eq(programs.id, referralClicks.programId))
        .where(and(eq(programs.workspaceId, workspaceId), notLike(referralClicks.visitorId, "v_sim%"))),

      // `webhook_events` itself stays closed to `authenticated` (migration 0001
      // §10). `latest_webhook_event` (migration 0007) is a SECURITY DEFINER
      // function that returns only the time, type and outcome of the latest
      // event, and nothing at all to a non-member. See DATABASE.md §6.
      tx.execute<LatestWebhookEventRow>(
        sql`select received_at, event_type, status from public.latest_webhook_event(${workspaceId})`,
      ),
      environmentEvidence(tx, workspaceId),
    ])
    const lastEvent = events[0]
    const lastClickAt = clicks?.lastClickAt ?? null

    return {
      stripe: {
        configured: integration?.status === "connected",
        secretSaved: integration?.secretSaved ?? false,
        lastEventAt: lastEvent ? new Date(lastEvent.received_at) : null,
        lastEventType: lastEvent?.event_type ?? null,
        lastEventFailed: lastEvent?.status === "failed",
        environments,
      },
      tracking: { lastClickAt: lastClickAt ? new Date(lastClickAt) : null },
    }
  })
}

/**
 * The latest founder-billing event per environment, through the SECURITY
 * DEFINER overload `latest_webhook_event(uuid, environment)` (migration 0012):
 * members read the time, type and outcome only — `webhook_events` stays closed.
 */
async function environmentEvidence(
  tx: Transaction,
  workspaceId: string,
): Promise<Record<"test" | "live", EnvironmentEvidence>> {
  const read = async (environment: "test" | "live"): Promise<EnvironmentEvidence> => {
    const { rows } = await tx.execute<LatestWebhookEventRow>(
      sql`select received_at, event_type, status
            from public.latest_webhook_event(${workspaceId}, ${environment}::public.environment)`,
    )
    const row = rows[0]
    return {
      lastEventAt: row ? new Date(row.received_at) : null,
      lastEventType: row?.event_type ?? null,
      lastEventFailed: row?.status === "failed",
      exact: true,
    }
  }
  const [test, live] = await Promise.all([read("test"), read("live")])
  return { test, live }
}
