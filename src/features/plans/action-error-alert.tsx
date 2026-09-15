import { InlineAlert } from "@/components/feedback/inline-alert"
import type { PlanUpgradeHint } from "@/i18n/errors"
import type { PlanCode } from "@/lib/plans"

import { upgradeOffer } from "./plan-display"
import { UpgradePrompt } from "./upgrade-prompt"

/**
 * A form's error, told the right way: a plan refusal (`PLAN_LIMIT_REACHED`,
 * `FEATURE_NOT_AVAILABLE`, `LIVE_MODE_REQUIRED`) becomes the upgrade prompt
 * with the translated error as its headline; anything else is the plain danger
 * alert. Pair it with an action that returns `actionFailure(error, key)` from
 * `@/i18n/errors`, whose state is `{ error?: string; upgrade?: PlanUpgradeHint }`.
 *
 *   <ActionErrorAlert error={state.error} upgrade={state.upgrade} workspaceSlug={slug} />
 */
export function ActionErrorAlert({
  error,
  upgrade,
  workspaceSlug,
  currentPlan,
  className,
}: {
  error?: string
  upgrade?: PlanUpgradeHint
  workspaceSlug: string
  currentPlan?: PlanCode
  className?: string
}) {
  if (!error) return null

  // A limit or feature error names its plan; `upgradeTo: null` means no plan
  // helps, so no prompt. Live mode's error carries none: the cheapest plan with it.
  const offerable =
    upgrade &&
    (upgrade.code === "LIVE_MODE_REQUIRED" || upgrade.upgradeTo !== null) &&
    upgradeOffer(upgrade.reason, { currentPlan, upgradeTo: upgrade.upgradeTo }) !== null

  if (upgrade && offerable) {
    return (
      <UpgradePrompt
        reason={upgrade.reason}
        upgradeTo={upgrade.upgradeTo}
        currentPlan={currentPlan}
        workspaceSlug={workspaceSlug}
        message={error}
        className={className}
      />
    )
  }

  return (
    <InlineAlert tone="danger" className={className}>
      {error}
    </InlineAlert>
  )
}
