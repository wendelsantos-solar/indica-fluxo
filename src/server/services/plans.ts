import "server-only"

import { logger } from "@/lib/logger"
import {
  fitsPlan,
  hasPlanFeature,
  planLimit,
  PLAN_KEYS,
  type PlanFeature,
  type PlanKey,
  type PlanResource,
} from "@/lib/plans"
import { type DbClient, withUser } from "@/server/db"
import { ConflictError, ForbiddenError, NotFoundError } from "@/server/policies/errors"
import { requireMembership } from "@/server/policies/workspace"
import {
  countPlanUsage,
  findOpenUpgradeRequest,
  findWorkspacePlan,
  insertUpgradeRequest,
} from "@/server/repositories/plans"

// `audit.ts` imports `assertPlanFeature` back; both sides only call each other
// at run time, never during module evaluation, so the cycle is harmless.
import { recordAudit } from "./audit"

/**
 * Plan enforcement. Services call these inside their own transaction, before
 * the write, so a limit cannot be raced past by two requests in parallel any
 * more than the existing unique constraints allow. Limits come from
 * `src/lib/plans.ts`, the same table the pricing page renders.
 */

export class PlanLimitError extends ConflictError {
  constructor(readonly resource: PlanResource, readonly limit: number) {
    super(`The ${resource} limit of this plan (${limit}) has been reached.`, `planLimit.${resource}`)
  }
}

export class PlanFeatureError extends ForbiddenError {
  constructor(readonly feature: PlanFeature) {
    super(`This plan does not include ${feature}.`, `planFeature.${feature}`)
  }
}

async function planOf(tx: DbClient, workspaceId: string): Promise<PlanKey> {
  const plan = await findWorkspacePlan(tx, workspaceId)
  if (!plan) throw new NotFoundError("Workspace not found.", "workspaceNotFound")
  return plan
}

export async function assertWithinPlan(
  tx: DbClient,
  workspaceId: string,
  resource: PlanResource,
  adding = 1,
): Promise<void> {
  const plan = await planOf(tx, workspaceId)
  const usage = await countPlanUsage(tx, workspaceId)
  if (!fitsPlan(plan, resource, usage[resource], adding)) {
    throw new PlanLimitError(resource, planLimit(plan, resource) ?? 0)
  }
}

export async function assertPlanFeature(tx: DbClient, workspaceId: string, feature: PlanFeature): Promise<void> {
  const plan = await planOf(tx, workspaceId)
  if (!hasPlanFeature(plan, feature)) throw new PlanFeatureError(feature)
}

export interface PlanOverview {
  plan: PlanKey
  usage: Record<PlanResource, number>
  limits: Record<PlanResource, number | null>
  openRequest: { requestedPlan: PlanKey; createdAt: Date } | null
}

/** What Settings shows: the plan, usage against each limit, a pending request. */
export async function getPlanOverview(userId: string, workspaceId: string): Promise<PlanOverview> {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId)
    const plan = await planOf(tx, workspaceId)
    const usage = await countPlanUsage(tx, workspaceId)
    const openRequest = await findOpenUpgradeRequest(tx, workspaceId)
    return {
      plan,
      usage,
      limits: {
        programs: planLimit(plan, "programs"),
        affiliates: planLimit(plan, "affiliates"),
        members: planLimit(plan, "members"),
      },
      openRequest: openRequest ? { requestedPlan: openRequest.requestedPlan, createdAt: openRequest.createdAt } : null,
    }
  })
}

/**
 * Records a request to move to a higher plan. Idempotent: an open request for
 * the same plan is kept, not duplicated (partial unique index).
 */
export async function requestPlanUpgrade(userId: string, workspaceId: string, requestedPlan: PlanKey) {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")
    const current = await planOf(tx, workspaceId)
    if (PLAN_KEYS.indexOf(requestedPlan) <= PLAN_KEYS.indexOf(current)) {
      throw new ConflictError("The workspace is already on this plan or a higher one.", "planAlreadyIncluded")
    }
    const inserted = await insertUpgradeRequest(tx, { workspaceId, requestedPlan, requestedBy: userId })
    if (inserted) {
      await recordAudit(tx, {
        workspaceId,
        actorUserId: userId,
        entityType: "plan_upgrade_request",
        entityId: inserted.id,
        action: "plan.upgrade_requested",
        metadata: { from: current, to: requestedPlan },
      })
      // The operator's signal: there is no in-app inbox for these requests, so
      // the log line is what alerting watches (README, "Mudar o plano").
      logger.info("plan upgrade requested", { workspaceId, from: current, to: requestedPlan })
    }
    return findOpenUpgradeRequest(tx, workspaceId)
  })
}
