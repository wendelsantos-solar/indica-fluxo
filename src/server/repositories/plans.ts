import "server-only"

import { and, desc, eq, isNull, sql } from "drizzle-orm"

import type { PlanCode, PlanLimit } from "@/lib/plans"
import { type DbClient } from "@/server/db"
import { planUpgradeRequests, workspaceSubscriptions } from "@/server/db/schema"
import type { SubscriptionSnapshot } from "@/server/domain/entitlements"

/** The workspace's subscription to IndicaFluxo, or `null` (Sandbox). Readable by members. */
export async function findWorkspaceSubscription(tx: DbClient, workspaceId: string) {
  const [row] = await tx
    .select({
      plan: workspaceSubscriptions.plan,
      status: workspaceSubscriptions.status,
      provider: workspaceSubscriptions.provider,
      cancelAtPeriodEnd: workspaceSubscriptions.cancelAtPeriodEnd,
      currentPeriodStart: workspaceSubscriptions.currentPeriodStart,
      currentPeriodEnd: workspaceSubscriptions.currentPeriodEnd,
      pastDueSince: workspaceSubscriptions.pastDueSince,
      trialEndsAt: workspaceSubscriptions.trialEndsAt,
      hasBillingCustomer: sql<boolean>`${workspaceSubscriptions.providerCustomerId} is not null`,
    })
    .from(workspaceSubscriptions)
    .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
    .limit(1)
  return row ?? null
}

export type WorkspaceSubscriptionRow = NonNullable<Awaited<ReturnType<typeof findWorkspaceSubscription>>>

export function toSnapshot(row: WorkspaceSubscriptionRow | null): SubscriptionSnapshot | null {
  if (!row) return null
  return {
    plan: row.plan,
    status: row.status,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    currentPeriodEnd: row.currentPeriodEnd,
    pastDueSince: row.pastDueSince,
  }
}

/**
 * Current usage of every limit, as `public.workspace_plan_usage` defines it
 * (migration 0010 — the counting rules live there, in one place).
 *
 * Fails closed: the function answers only a member of the workspace, so called
 * outside `withUser()` (e.g. on the service connection) it returns no row, and
 * treating that as zero usage would let every limit pass.
 */
export async function countPlanUsage(tx: DbClient, workspaceId: string): Promise<Record<PlanLimit, number>> {
  const { rows } = await tx.execute<{
    live_programs: number
    test_programs: number
    affiliates: number
    members: number
  }>(sql`select * from public.workspace_plan_usage(${workspaceId})`)
  const row = rows[0]
  if (!row) {
    throw new Error("Plan usage is only readable by a member of the workspace; call inside withUser().")
  }
  return {
    livePrograms: row.live_programs,
    testPrograms: row.test_programs,
    affiliates: row.affiliates,
    members: row.members,
  }
}

/**
 * Serialises limit checks per workspace and resource for the rest of the
 * transaction: two parallel "create" requests cannot both see room for one.
 */
export async function lockLimit(tx: DbClient, workspaceId: string, limit: PlanLimit): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`plan:${workspaceId}:${limit}`}, 0))`)
}

export async function findOpenUpgradeRequest(tx: DbClient, workspaceId: string) {
  const [row] = await tx
    .select({
      id: planUpgradeRequests.id,
      requestedPlan: planUpgradeRequests.requestedPlan,
      createdAt: planUpgradeRequests.createdAt,
    })
    .from(planUpgradeRequests)
    .where(and(eq(planUpgradeRequests.workspaceId, workspaceId), isNull(planUpgradeRequests.handledAt)))
    .orderBy(desc(planUpgradeRequests.createdAt))
    .limit(1)
  return row ?? null
}

export async function insertUpgradeRequest(
  tx: DbClient,
  params: { workspaceId: string; requestedPlan: PlanCode; requestedBy: string },
) {
  const [row] = await tx
    .insert(planUpgradeRequests)
    .values(params)
    .onConflictDoNothing()
    .returning({ id: planUpgradeRequests.id })
  return row ?? null
}
