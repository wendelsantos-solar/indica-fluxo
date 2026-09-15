import "server-only"

import {
  cheapestPlanForLimit,
  cheapestPlanWithFeature,
  fitsLimit,
  type PlanFeature,
  type PlanLimit,
} from "@/lib/plans"
import { type DbClient } from "@/server/db"
import { overLimits, resolveEntitlements, type Entitlements, type PlanUsage } from "@/server/domain/entitlements"
import {
  FeatureNotAvailableError,
  LiveModeRequiredError,
  PlanLimitReachedError,
  SubscriptionRequiredError,
} from "@/server/policies/errors"
import { countPlanUsage, findWorkspaceSubscription, lockLimit, toSnapshot } from "@/server/repositories/plans"

/**
 * The only place a service asks "may this workspace do X?". Callers pass the
 * transaction they already hold (RLS as the user, or the service connection on
 * ingest paths) and never branch on a plan code themselves.
 *
 *   const entitlements = await getWorkspaceEntitlements(tx, workspaceId)
 *   assertFeature(entitlements, "customAffiliateRates")
 *   await assertWithinLimit(tx, workspaceId, entitlements, "livePrograms")
 *
 * Plan gating is on top of authorisation, never instead of it: call
 * `requireMembership` first. See docs/PLANS.md.
 */

export async function getWorkspaceEntitlements(
  tx: DbClient,
  workspaceId: string,
  now: Date = new Date(),
): Promise<Entitlements> {
  const subscription = await findWorkspaceSubscription(tx, workspaceId)
  return resolveEntitlements(toSnapshot(subscription), now)
}

/** The effective plan code. */
export async function getWorkspacePlan(tx: DbClient, workspaceId: string) {
  return (await getWorkspaceEntitlements(tx, workspaceId)).plan
}

export function canUseFeature(entitlements: Entitlements, feature: PlanFeature): boolean {
  return entitlements.capabilities.features[feature]
}

export function assertFeature(entitlements: Entitlements, feature: PlanFeature): void {
  if (feature === "liveMode") return assertLiveMode(entitlements)
  if (!canUseFeature(entitlements, feature)) {
    throw new FeatureNotAvailableError(feature, cheapestPlanWithFeature(feature))
  }
}

/** Live data is processed only for a plan with live mode in good standing. */
export function assertLiveMode(entitlements: Entitlements): void {
  if (entitlements.standing === "restricted") throw new SubscriptionRequiredError()
  if (!canUseFeature(entitlements, "liveMode")) throw new LiveModeRequiredError()
}

/** Blocks creation while payment is overdue past the grace period. */
export function assertCanCreate(entitlements: Entitlements): void {
  if (!entitlements.canCreate) throw new SubscriptionRequiredError()
}

/**
 * Asserts `adding` more of `limit` fits, holding a per-workspace lock for the
 * rest of the transaction so concurrent requests are serialised. Call it in
 * the same transaction as the write it protects, before the write.
 */
export async function assertWithinLimit(
  tx: DbClient,
  workspaceId: string,
  entitlements: Entitlements,
  limit: PlanLimit,
  adding = 1,
): Promise<void> {
  assertCanCreate(entitlements)
  const max = entitlements.capabilities.limits[limit]
  if (max === null) return
  await lockLimit(tx, workspaceId, limit)
  const usage = await countPlanUsage(tx, workspaceId)
  if (!fitsLimit(max, usage[limit], adding)) {
    throw new PlanLimitReachedError(limit, max, cheapestPlanForLimit(limit, usage[limit] + adding))
  }
}

export interface PlanStatus {
  entitlements: Entitlements
  usage: PlanUsage
  overLimit: ReturnType<typeof overLimits>
}

/** Plan, usage and over-limit state, for Settings and upgrade prompts. */
export async function getPlanStatus(tx: DbClient, workspaceId: string): Promise<PlanStatus> {
  const [entitlements, usage] = await Promise.all([
    getWorkspaceEntitlements(tx, workspaceId),
    countPlanUsage(tx, workspaceId),
  ])
  return { entitlements, usage, overLimit: overLimits(entitlements, usage) }
}
