import "server-only"

import { and, desc, eq, gte, isNotNull, min, notLike, sql } from "drizzle-orm"

import { CONNECTORS, isConnectorId, type ConnectorAvailability, type ConnectorId } from "@/lib/billing/catalog"
import { isReasonCode, type ReasonCode } from "@/lib/billing/reasons"
import type { BillingEnvironment } from "@/lib/billing/types"
import { deriveConnectionHealth, type ConnectionHealth } from "@/features/integrations/health"
import { withUser, type Transaction } from "@/server/db"
import { qualified } from "@/server/db/qualify"
import {
  attributions,
  attributionTokens,
  billingIdentities,
  commissions,
  customers,
  programs,
  referralClicks,
  transactions,
  workspaces,
} from "@/server/db/schema"
import { requireMembership } from "@/server/policies/workspace"

import { connectorAvailability, listBillingConnections, readBillingSelection, type BillingConnection } from "./billing-connections"

/**
 * Evidence that the integration works, per connection and for the whole
 * workspace — the reads behind the Integrations overview, the connection
 * detail, the diagnostics pipeline and the setup funnel.
 *
 * Everything is read under RLS as the member (`withUser`). `webhook_events`
 * stays closed: its per-connection summary comes through the SECURITY DEFINER
 * `billing_connection_events` / `billing_connection_recent_events`
 * (migration 0018), which return times, types, statuses, reason codes and
 * counts — never an error text or a payload.
 */

export const EVIDENCE_WINDOW_DAYS = 30

interface ConnectionEventRow extends Record<string, unknown> {
  integration_id: string
  last_event_at: Date | string | null
  last_event_type: string | null
  last_status: "received" | "processed" | "failed" | "ignored" | null
  last_reason_code: string | null
  events: string | number
  failed: string | number
  unsupported: string | number
  without_customer: string | number
  mismatched: string | number
}

export interface ConnectionSummary extends BillingConnection {
  lastEventAt: Date | null
  lastEventType: string | null
  lastReasonCode: ReasonCode | null
  events: number
  payments: number
  paymentsWithCommission: number
  expectedWithoutCommission: number
  health: ConnectionHealth
}

export interface IntegrationOverview {
  connections: ConnectionSummary[]
  availability: Record<ConnectorId, ConnectorAvailability>
  /** What the founder said they charge through; `null` when never asked. */
  selection: ConnectorId[] | null
  /** "Outro" was ticked: a method with no connector. Informational only. */
  selectionOther: boolean
  tracker: { lastClickAt: Date | null; firstClickAt: Date | null }
  identity: {
    /** Latest customer an identify call created or updated. */
    lastIdentifyAt: Date | null
    firstIdentifyAt: Date | null
    /** Latest checkout reference bound by a provider event (Flow B). */
    lastReferenceBoundAt: Date | null
  }
  workspaceCreatedAt: Date
}

const since = (now: Date) => new Date(now.getTime() - EVIDENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000)

export async function getIntegrationOverview(
  userId: string,
  workspaceId: string,
  now: Date = new Date(),
): Promise<IntegrationOverview> {
  const [connections, selection] = await Promise.all([
    listBillingConnections(userId, workspaceId),
    readBillingSelection(userId, workspaceId),
  ])

  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId)
    const window = since(now)

    const [{ rows: eventRows }, paymentRows, [clicks], [identified], [bound], [workspace]] = await Promise.all([
      tx.execute<ConnectionEventRow>(
        sql`select * from public.billing_connection_events(${workspaceId}, ${window.toISOString()}::timestamptz)`,
      ),
      paymentsByConnection(tx, workspaceId, window, connections),
      // Simulated clicks (`v_sim…`, services/sandbox.ts) prove nothing about the tracker.
      tx
        .select({ last: sql<Date | null>`max(${referralClicks.occurredAt})`, first: min(referralClicks.occurredAt) })
        .from(referralClicks)
        .innerJoin(programs, eq(programs.id, referralClicks.programId))
        .where(and(eq(programs.workspaceId, workspaceId), notLike(referralClicks.visitorId, "v_sim%"))),
      tx
        .select({ last: sql<Date | null>`max(${customers.updatedAt})`, first: min(customers.createdAt) })
        .from(customers)
        .where(
          and(
            eq(customers.workspaceId, workspaceId),
            isNotNull(customers.externalId),
            notLike(customers.externalId, "sim_%"),
          ),
        ),
      tx
        .select({ last: sql<Date | null>`max(${attributionTokens.boundAt})` })
        .from(attributionTokens)
        .where(and(eq(attributionTokens.workspaceId, workspaceId), isNotNull(attributionTokens.boundAt))),
      tx.select({ createdAt: workspaces.createdAt }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1),
    ])

    const events = new Map(eventRows.map((row) => [row.integration_id, row]))
    const toDate = (value: Date | string | null | undefined) => (value ? new Date(value) : null)

    const summaries = connections.map((connection): ConnectionSummary => {
      const row = events.get(connection.id)
      const payments = paymentRows.get(connection.id) ?? { payments: 0, withCommission: 0, expectedWithout: 0 }
      const lastEventAt = toDate(row?.last_event_at)
      const evidence = {
        status: connection.status,
        statusReason: connection.statusReason,
        credentialsSaved: connection.credentialsSaved || connection.mode === "oauth",
        configuredAt: connection.lastVerifiedAt ?? connection.connectedAt,
        lastRejectedAt: connection.lastRejectedAt,
        lastEventAt,
        lastEventFailed: row?.last_status === "failed",
        events: Number(row?.events ?? 0),
        failed: Number(row?.failed ?? 0),
        unsupported: Number(row?.unsupported ?? 0),
        withoutCustomer: Number(row?.without_customer ?? 0),
        mismatched: Number(row?.mismatched ?? 0),
        payments: payments.payments,
        paymentsWithCommission: payments.withCommission,
        expectedWithoutCommission: payments.expectedWithout,
      }
      return {
        ...connection,
        lastEventAt,
        lastEventType: row?.last_event_type ?? null,
        lastReasonCode: isReasonCode(row?.last_reason_code) ? row.last_reason_code : null,
        events: evidence.events,
        payments: payments.payments,
        paymentsWithCommission: payments.withCommission,
        expectedWithoutCommission: payments.expectedWithout,
        health: deriveConnectionHealth(evidence, now),
      }
    })

    return {
      connections: summaries,
      availability: connectorAvailability(),
      selection: selection?.providers ?? null,
      selectionOther: selection?.other ?? false,
      tracker: { lastClickAt: toDate(clicks?.last), firstClickAt: toDate(clicks?.first) },
      identity: {
        lastIdentifyAt: toDate(identified?.last),
        firstIdentifyAt: toDate(identified?.first),
        lastReferenceBoundAt: toDate(bound?.last),
      },
      workspaceCreatedAt: workspace?.createdAt ?? now,
    }
  })
}

/**
 * "This payment's customer has a live attribution" — the SQL both the health
 * counts and the diagnostics list use to tell an organic payment (normal) from
 * one that should have earned and did not (a warning). Matches the way the
 * commission writer finds an attribution: the customer's own id, or any of its
 * provider identities as attributions store them.
 */
function attributedAtPayment() {
  return sql`exists (
    select 1 from ${attributions} a
      join ${programs} p on p.id = a.program_id
     where p.workspace_id = ${qualified(transactions.workspaceId)}
       and p.environment = ${qualified(transactions.environment)}
       and a.attributed_at <= ${qualified(transactions.occurredAt)}
       and a.expires_at > ${qualified(transactions.occurredAt)}
       and (
         (a.customer_external_id is not null and a.customer_external_id = (
            select c.external_id from ${customers} c where c.id = ${qualified(transactions.customerId)}))
         or a.provider_customer_id in (
            select case when bi.provider in ('stripe', 'manual', 'paddle') then bi.provider_customer_id
                        else bi.provider::text || ':' || bi.provider_customer_id end
              from ${billingIdentities} bi
             where bi.customer_id = ${qualified(transactions.customerId)})
       ))`
}

function commissioned() {
  return sql`exists (
    select 1 from ${commissions}
     where ${qualified(commissions.transactionId)} = ${qualified(transactions.id)}
       and ${commissions.reversalOfCommissionId} is null)`
}

/**
 * Payments per connection in the window. A payment recorded before
 * `transactions.integration_id` existed (NULL) counts for the workspace's
 * oldest connection of its provider, which is the one that recorded it.
 */
async function paymentsByConnection(
  tx: Transaction,
  workspaceId: string,
  window: Date,
  connections: BillingConnection[],
): Promise<Map<string, { payments: number; withCommission: number; expectedWithout: number }>> {
  const rows = await tx
    .select({
      integrationId: transactions.integrationId,
      provider: transactions.provider,
      payments: sql<number>`count(*)::int`,
      withCommission: sql<number>`count(*) filter (where ${commissioned()})::int`,
      expectedWithout: sql<number>`count(*) filter (where not ${commissioned()} and ${attributedAtPayment()})::int`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.workspaceId, workspaceId),
        eq(transactions.type, "payment"),
        eq(transactions.status, "succeeded"),
        gte(transactions.occurredAt, window),
      ),
    )
    .groupBy(transactions.integrationId, transactions.provider)

  const oldestByProvider = new Map<string, string>()
  for (const connection of connections) {
    if (!oldestByProvider.has(connection.provider)) oldestByProvider.set(connection.provider, connection.id)
  }

  const result = new Map<string, { payments: number; withCommission: number; expectedWithout: number }>()
  for (const row of rows) {
    const id = row.integrationId ?? oldestByProvider.get(row.provider)
    if (!id) continue
    const current = result.get(id) ?? { payments: 0, withCommission: 0, expectedWithout: 0 }
    current.payments += row.payments
    current.withCommission += row.withCommission
    current.expectedWithout += row.expectedWithout
    result.set(id, current)
  }
  return result
}

// ---------------------------------------------------------------------------
// Diagnostics: one connection's recent events, and "why did this payment not
// become a commission?"
// ---------------------------------------------------------------------------

export interface RecentEvent {
  receivedAt: Date
  eventType: string
  status: "received" | "processed" | "failed" | "ignored"
  reasonCode: ReasonCode | null
  environment: BillingEnvironment | null
  /** The provider's id (for non-Stripe, after the connection prefix). Not a secret. */
  providerEventId: string
}

export async function listConnectionEvents(
  userId: string,
  workspaceId: string,
  integrationId: string,
  limit = 20,
): Promise<RecentEvent[]> {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId)
    const { rows } = await tx.execute<{
      received_at: Date | string
      event_type: string
      status: RecentEvent["status"]
      reason_code: string | null
      environment: BillingEnvironment | null
      provider_event_id: string
    }>(sql`select * from public.billing_connection_recent_events(${workspaceId}, ${integrationId}, ${limit})`)
    return rows.map((row) => ({
      receivedAt: new Date(row.received_at),
      eventType: row.event_type,
      status: row.status,
      reasonCode: isReasonCode(row.reason_code) ? row.reason_code : null,
      environment: row.environment,
      providerEventId: row.provider_event_id.startsWith(`${integrationId}:`)
        ? row.provider_event_id.slice(integrationId.length + 1)
        : row.provider_event_id,
    }))
  })
}

export type PipelineStep = "referral" | "attribution" | "customer" | "billingIdentity" | "providerEvent" | "transaction" | "commission"
export type PipelineState = "ok" | "missing" | "notApplicable"

export interface PaymentDiagnosis {
  transactionId: string
  provider: string
  providerTransactionId: string
  environment: BillingEnvironment
  currency: string
  grossAmountMinor: number
  occurredAt: Date
  /** `organic`: nobody referred this customer — normal. `expected`: an attributed customer earned nothing. */
  classification: "commissioned" | "organic" | "expected"
  steps: Record<PipelineStep, PipelineState>
}

/**
 * The latest payments of the workspace, each with its pipeline — referral →
 * attribution → customer → billing identity → provider event → transaction →
 * commission — so "why did this payment not become a commission?" has an
 * answer on screen. Optionally one environment or one connection's provider.
 */
export async function diagnoseRecentPayments(
  userId: string,
  workspaceId: string,
  options: { environment?: BillingEnvironment; provider?: string; limit?: number } = {},
): Promise<PaymentDiagnosis[]> {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId)

    const rows = await tx
      .select({
        id: transactions.id,
        provider: transactions.provider,
        providerTransactionId: transactions.providerTransactionId,
        environment: transactions.environment,
        currency: transactions.currency,
        grossAmountMinor: transactions.grossAmountMinor,
        occurredAt: transactions.occurredAt,
        commissioned: sql<boolean>`${commissioned()}`,
        attributed: sql<boolean>`${attributedAtPayment()}`,
        hasAnyAttribution: sql<boolean>`exists (
          select 1 from ${attributions} a join ${programs} p on p.id = a.program_id
           where p.workspace_id = ${qualified(transactions.workspaceId)}
             and (a.customer_external_id = (select c.external_id from ${customers} c where c.id = ${qualified(transactions.customerId)})
               or a.provider_customer_id in (
                 select case when bi.provider in ('stripe', 'manual', 'paddle') then bi.provider_customer_id
                             else bi.provider::text || ':' || bi.provider_customer_id end
                   from ${billingIdentities} bi where bi.customer_id = ${qualified(transactions.customerId)})))`,
        hasClick: sql<boolean>`exists (
          select 1 from ${attributions} a join ${programs} p on p.id = a.program_id
           where p.workspace_id = ${qualified(transactions.workspaceId)}
             and a.first_click_id is not null
             and (a.customer_external_id = (select c.external_id from ${customers} c where c.id = ${qualified(transactions.customerId)})
               or a.provider_customer_id in (
                 select case when bi.provider in ('stripe', 'manual', 'paddle') then bi.provider_customer_id
                             else bi.provider::text || ':' || bi.provider_customer_id end
                   from ${billingIdentities} bi where bi.customer_id = ${qualified(transactions.customerId)})))`,
        identified: sql<boolean>`exists (select 1 from ${customers} c where c.id = ${qualified(transactions.customerId)} and c.external_id is not null)`,
        hasIdentity: sql<boolean>`exists (select 1 from ${billingIdentities} bi where bi.customer_id = ${qualified(transactions.customerId)})
          or exists (select 1 from ${customers} c where c.id = ${qualified(transactions.customerId)} and c.provider_customer_id is not null)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.workspaceId, workspaceId),
          eq(transactions.type, "payment"),
          options.environment ? eq(transactions.environment, options.environment) : undefined,
          options.provider ? sql`${transactions.provider}::text = ${options.provider}` : undefined,
        ),
      )
      .orderBy(desc(transactions.occurredAt))
      .limit(Math.min(options.limit ?? 10, 50))

    return rows.map((row) => {
      const classification = row.commissioned ? "commissioned" : row.attributed ? "expected" : "organic"
      // `customer`: identified by the SaaS (Customer-first). A guest checkout that
      // earned through the reference alone never needed it: not applicable.
      // `attribution`: eligible = live at the payment date (or it earned).
      const steps: Record<PipelineStep, PipelineState> = {
        referral: row.hasClick ? "ok" : row.hasAnyAttribution ? "ok" : "missing",
        attribution: row.commissioned || row.attributed ? "ok" : "missing",
        customer: row.identified ? "ok" : row.commissioned || !row.hasAnyAttribution ? "notApplicable" : "missing",
        billingIdentity: row.hasIdentity ? "ok" : "missing",
        providerEvent: "ok",
        transaction: "ok",
        commission: row.commissioned ? "ok" : row.hasAnyAttribution ? "missing" : "notApplicable",
      }
      return {
        transactionId: row.id,
        provider: row.provider,
        providerTransactionId: row.providerTransactionId,
        environment: row.environment,
        currency: row.currency,
        grossAmountMinor: Number(row.grossAmountMinor),
        occurredAt: row.occurredAt,
        classification,
        steps,
      }
    })
  })
}

/** Display name of a connection: the founder's label, else the provider's name. */
export function connectionLabel(connection: Pick<BillingConnection, "provider" | "displayName">): string {
  if (connection.displayName) return connection.displayName
  return isConnectorId(connection.provider) ? CONNECTORS[connection.provider].name : connection.provider
}
