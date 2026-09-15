/**
 * The founder-dashboard navigation AS IT WAS before the performance audit
 * (PERFORMANCE_AUDIT.md), reproduced statement for statement so the bench can
 * interleave "before" and "after" runs under the same network conditions.
 * Remote round-trip time drifts over minutes; comparing two separate runs
 * would measure the drift.
 *
 * Differences from ./dashboard-requests.ts, each one an audit change:
 * - `withUserBefore`: two `set_config` statements instead of one;
 * - no per-request memo: the page re-reads the workspace, and the layout and
 *   `getViewEnvironment` each read the subscription;
 * - the layout loads every participation to test `length > 0`, sequentially;
 * - integration health and the overview's two aggregates are awaited one by one.
 *
 * The RLS policies are whatever the database currently has; migration 0013's
 * effect is measured separately (scripts/perf/explain-at-scale.ts).
 */
import { and, eq, max, notLike, sql } from "drizzle-orm"

import { resolveViewEnvironment } from "@/lib/view-environment"
import { db, type Transaction } from "@/server/db"
import { integrations, programs, referralClicks } from "@/server/db/schema"
import { requireMembership } from "@/server/policies/workspace"
import { listAffiliates, listParticipationsForUser } from "@/server/repositories/affiliates"
import {
  getConversionFunnel,
  getDashboardOverview,
  getRecentConversions,
  getRevenueSeries,
  getTopAffiliates,
  workspaceHasLivePrograms,
} from "@/server/repositories/analytics"
import { listPrograms } from "@/server/repositories/programs"
import { findWorkspaceBySlug, listWorkspacesForUser } from "@/server/repositories/workspaces"
import { getWorkspaceEntitlements } from "@/server/services/entitlements"

function withUserBefore<T>(userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const claims = JSON.stringify({ sub: userId, role: "authenticated" })
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`)
    await tx.execute(sql`select set_config('role', 'indica_app', true)`)
    return fn(tx)
  })
}

async function getWorkspaceForUser(userId: string, slug: string) {
  const workspace = await withUserBefore(userId, (tx) => findWorkspaceBySlug(tx, slug, userId))
  if (!workspace) throw new Error("workspace not found")
  return workspace
}

async function viewEnvironment(userId: string, workspaceId: string) {
  const { entitlements, hasLivePrograms } = await withUserBefore(userId, async (tx) => ({
    entitlements: await getWorkspaceEntitlements(tx, workspaceId),
    hasLivePrograms: await workspaceHasLivePrograms(tx, workspaceId),
  }))
  const liveModeAvailable = entitlements.capabilities.features.liveMode
  return { ...resolveViewEnvironment({ requested: undefined, liveModeAvailable, hasLivePrograms }), liveModeAvailable }
}

/** `getIntegrationHealth` before: every read awaited in turn. */
async function integrationHealthBefore(userId: string, workspaceId: string) {
  return withUserBefore(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId)
    const [integration] = await tx
      .select({ status: integrations.status })
      .from(integrations)
      .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, "stripe")))
      .limit(1)
    const [clicks] = await tx
      .select({ lastClickAt: max(referralClicks.occurredAt) })
      .from(referralClicks)
      .innerJoin(programs, eq(programs.id, referralClicks.programId))
      .where(and(eq(programs.workspaceId, workspaceId), notLike(referralClicks.visitorId, "v_sim%")))
    const events = await tx.execute(sql`select received_at, event_type, status from public.latest_webhook_event(${workspaceId})`)
    const test = await tx.execute(sql`select received_at from public.latest_webhook_event(${workspaceId}, 'test'::public.environment)`)
    const live = await tx.execute(sql`select received_at from public.latest_webhook_event(${workspaceId}, 'live'::public.environment)`)
    return { integration, clicks, events, test, live }
  })
}

export async function loadDashboardLayoutBefore(userId: string, slug: string) {
  const workspaces = await withUserBefore(userId, (tx) => listWorkspacesForUser(tx, userId))
  if (!workspaces.some((workspace) => workspace.slug === slug)) throw new Error("not a member")
  const workspace = await getWorkspaceForUser(userId, slug)
  const { participations, entitlements } = await withUserBefore(userId, async (tx) => ({
    participations: await listParticipationsForUser(tx, userId),
    entitlements: await getWorkspaceEntitlements(tx, workspace.id),
  }))
  const environment = await viewEnvironment(userId, workspace.id)
  return { workspaces, workspace, isAffiliate: participations.length > 0, entitlements, environment }
}

export async function loadOverviewBefore(userId: string, slug: string) {
  const workspace = await getWorkspaceForUser(userId, slug)
  const { environment } = await viewEnvironment(userId, workspace.id)
  const period = { days: 30, timeZone: workspace.timezone, now: new Date() }

  return Promise.all([
    integrationHealthBefore(userId, workspace.id),
    withUserBefore(userId, async (tx) => {
      // Not reproducible without copying its SQL: before the audit the
      // overview's two aggregates were awaited one after the other, and the
      // current repository pipelines them. This mirror therefore understates
      // the old cost by one sequential statement — the measured delta is
      // conservative.
      const overview = await getDashboardOverview(tx, workspace.id, environment, period)
      return Promise.all([
        getRevenueSeries(tx, workspace.id, environment, overview.currency, period),
        getConversionFunnel(tx, workspace.id, environment, period),
        getTopAffiliates(tx, workspace.id, environment),
        getRecentConversions(tx, workspace.id, environment),
        listPrograms(tx, workspace.id),
        listAffiliates(tx, { workspaceId: workspace.id, limit: 1 }),
      ])
    }),
  ])
}

/** Layout and page concurrently, with nothing shared — as Next.js rendered them before. */
export function loadNavigationBefore(userId: string, slug: string) {
  return Promise.all([loadDashboardLayoutBefore(userId, slug), loadOverviewBefore(userId, slug)])
}
