"use client"

import { useTranslations } from "next-intl"
import { useActionState } from "react"

import { InlineAlert } from "@/components/feedback/inline-alert"
import { Button } from "@/components/ui/button"
import type { PlanKey } from "@/lib/plans"

import { requestPlanUpgradeAction, type PlanActionState } from "./actions"

const INITIAL: PlanActionState = {}

/**
 * The one control on the plan panel. Success is not rendered here: the action
 * revalidates Settings, and the panel then shows the open request from the
 * database, which is the state that survives a reload.
 */
export function RequestUpgradeForm({ workspaceId, plan }: { workspaceId: string; plan: PlanKey }) {
  const t = useTranslations("plans.panel")
  const tn = useTranslations("plans.names")
  const [state, action, pending] = useActionState(requestPlanUpgradeAction, INITIAL)

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="plan" value={plan} />
      <Button type="submit" variant="secondary" loading={pending} className="max-sm:w-full">
        {t("request", { plan: tn(plan) })}
      </Button>
      {state.error ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
    </form>
  )
}
