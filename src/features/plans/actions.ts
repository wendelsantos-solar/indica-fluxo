"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { actionError, successMessage } from "@/i18n/errors"
import { DASHBOARD_LAYOUT } from "@/lib/revalidate"
import { requireUser } from "@/server/auth/session"
import { requestPlanUpgrade } from "@/server/services/plans"

export interface PlanActionState {
  error?: string
  success?: string
}

const requestSchema = z.object({
  workspaceId: z.string().uuid(),
  // The purchasable plans (`PURCHASABLE_PLANS` in `@/lib/plans`).
  plan: z.enum(["launch", "growth"]),
})

/**
 * Manual activation request — only offered where platform billing is not
 * configured (docs/PLANS.md §5). Nothing is charged and nothing changes yet:
 * the team follows up and grants the plan.
 */
export async function requestPlanUpgradeAction(
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const user = await requireUser()

  const parsed = requestSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    plan: formData.get("plan"),
  })
  if (!parsed.success) return { error: await actionError(null, "invalidRequest") }

  try {
    await requestPlanUpgrade(user.id, parsed.data.workspaceId, parsed.data.plan)
  } catch (error) {
    return { error: await actionError(error, "planUpgradeNotRequested") }
  }

  revalidatePath(DASHBOARD_LAYOUT, "layout")
  return { success: await successMessage("planUpgradeRequested") }
}
