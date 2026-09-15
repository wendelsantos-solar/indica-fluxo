"use client"

import { useActionState } from "react"

import { InlineAlert } from "@/components/feedback/inline-alert"
import { Button } from "@/components/ui/button"

import { requestPlanUpgradeAction, type PlanActionState } from "./actions"

const INITIAL: PlanActionState = {}

/**
 * The manual path, offered only when platform billing is not configured.
 * Success is not rendered here: the action revalidates Settings, and the panel
 * then shows the open request from the database, the state that survives a reload.
 */
export function RequestUpgradeForm({
  workspaceId,
  plan,
  label,
  className,
}: {
  workspaceId: string
  plan: "launch" | "growth"
  label: string
  className?: string
}) {
  const [state, action, pending] = useActionState(requestPlanUpgradeAction, INITIAL)

  return (
    <form action={action} className={className}>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="plan" value={plan} />
      <Button type="submit" variant="secondary" loading={pending} className="max-sm:w-full">
        {label}
      </Button>
      {state.error ? (
        <InlineAlert tone="danger" className="mt-3">
          {state.error}
        </InlineAlert>
      ) : null}
    </form>
  )
}
