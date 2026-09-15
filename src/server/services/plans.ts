import "server-only"

import { planRank, type PlanCode } from "@/lib/plans"
import { logger } from "@/lib/logger"
import { withUser } from "@/server/db"
import { platformBillingEnv } from "@/lib/env/server"
import { ConflictError } from "@/server/policies/errors"
import { requireMembership } from "@/server/policies/workspace"
import { findOpenUpgradeRequest, insertUpgradeRequest } from "@/server/repositories/plans"

// `audit.ts` imports `entitlements.ts`; this module only calls `recordAudit`
// at run time, so the import graph stays acyclic at evaluation.
import { recordAudit } from "./audit"
import { getPlanStatus, type PlanStatus } from "./entitlements"

export interface PlanOverview extends PlanStatus {
  openRequest: { requestedPlan: PlanCode; createdAt: Date } | null
}

/** Plan, usage, over-limit state and any open manual request — Settings. */
export async function getPlanOverview(userId: string, workspaceId: string): Promise<PlanOverview> {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId)
    const [status, openRequest] = await Promise.all([
      getPlanStatus(tx, workspaceId),
      findOpenUpgradeRequest(tx, workspaceId),
    ])
    return {
      ...status,
      openRequest: openRequest ? { requestedPlan: openRequest.requestedPlan, createdAt: openRequest.createdAt } : null,
    }
  })
}

/**
 * Manual activation request — used only where platform billing is not
 * configured (no Stripe prices), so a founder still has a way to ask. With
 * billing configured, plans are bought through Checkout. Idempotent per plan.
 */
export async function requestPlanUpgrade(userId: string, workspaceId: string, requestedPlan: PlanCode) {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")
    // With platform billing configured, plans are bought through Checkout;
    // a manual request would bypass payment.
    if (platformBillingEnv()) {
      throw new ConflictError("Plans are purchased through checkout.", "billing.useCheckout")
    }
    const { entitlements } = await getPlanStatus(tx, workspaceId)
    if (planRank(requestedPlan) <= planRank(entitlements.subscribedPlan)) {
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
        metadata: { from: entitlements.subscribedPlan, to: requestedPlan },
      })
      logger.info("plan upgrade requested", { workspaceId, from: entitlements.subscribedPlan, to: requestedPlan })
    }
    return findOpenUpgradeRequest(tx, workspaceId)
  })
}
