import "server-only"

import { and, eq, gte, isNotNull, max, notLike, sql } from "drizzle-orm"

import { withUser, type Transaction } from "@/server/db"
import { qualified } from "@/server/db/qualify"
import { commissions, customers, integrations, programs, referralClicks, transactions } from "@/server/db/schema"
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
  /** Whether events turn into commissions, per Stripe mode — receiving is not enough. */
  attribution: Record<"test" | "live", AttributionEvidence>
}

/** How far back the attribution evidence looks. */
export const ATTRIBUTION_WINDOW_DAYS = 30

export interface AttributionEvidence {
  /** Payments recorded in the ledger within the window. */
  payments: number
  /** Of those, the ones that earned at least one commission (any status). */
  paymentsWithCommission: number
  /** Payments Stripe delivered in the window that were dropped: the event carried no customer. */
  paymentsWithoutCustomer: number
  /** The latest customer an identify call created or updated (it carries an external id). */
  lastIdentifyAt: Date | null
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

    const [[integration], [clicks], { rows: events }, environments, testAttribution, liveAttribution] = await Promise.all([
      // Any billing connection (multi-provider, migration 0018): the checklist's
      // "payments connected" step is about the workspace, not one provider.
      tx
        .select({
          status: integrations.status,
          secretSaved: sql<boolean>`${integrations.encryptedCredentials} is not null`,
        })
        .from(integrations)
        .where(eq(integrations.workspaceId, workspaceId))
        .orderBy(sql`(${integrations.status} = 'connected') desc`, integrations.createdAt)
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
      attributionEvidence(tx, workspaceId, "test"),
      attributionEvidence(tx, workspaceId, "live"),
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
      attribution: { test: testAttribution, live: liveAttribution },
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

/**
 * Whether one mode's payments become commissions. Payments and identified
 * customers are read from the ledger under RLS; payments dropped for lack of a
 * customer never reach the ledger, so they are counted through the SECURITY
 * DEFINER `webhook_payments_without_customer` (migration 0015).
 */
async function attributionEvidence(
  tx: Transaction,
  workspaceId: string,
  environment: "test" | "live",
  now = new Date(),
): Promise<AttributionEvidence> {
  const since = new Date(now.getTime() - ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  const [[payments], [identified], { rows: dropped }] = await Promise.all([
    tx
      .select({
        total: sql<number>`count(*)::int`,
        withCommission: sql<number>`count(*) filter (where exists (
          select 1 from ${commissions} where ${qualified(commissions.transactionId)} = ${qualified(transactions.id)}
        ))::int`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.workspaceId, workspaceId),
          eq(transactions.environment, environment),
          eq(transactions.type, "payment"),
          gte(transactions.createdAt, since),
        ),
      ),
    tx
      .select({ lastIdentifyAt: max(customers.updatedAt) })
      .from(customers)
      .where(
        and(
          eq(customers.workspaceId, workspaceId),
          eq(customers.environment, environment),
          isNotNull(customers.externalId),
        ),
      ),
    tx.execute<{ count: string | number }>(
      sql`select public.webhook_payments_without_customer(${workspaceId}, ${environment}::public.environment, ${since.toISOString()}::timestamptz) as count`,
    ),
  ])

  return {
    payments: payments?.total ?? 0,
    paymentsWithCommission: payments?.withCommission ?? 0,
    paymentsWithoutCustomer: Number(dropped[0]?.count ?? 0),
    lastIdentifyAt: identified?.lastIdentifyAt ? new Date(identified.lastIdentifyAt) : null,
  }
}
