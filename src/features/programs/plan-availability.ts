import { cheapestPlanForLimit, fitsLimit, type PlanCode } from "@/lib/plans"
import type { Entitlements, PlanUsage } from "@/server/domain/entitlements"

/**
 * What the programs pages may offer, from the plan — the same rules
 * `createProgram` enforces (docs/PLANS.md §3), so a form that cannot be saved
 * is not shown. Pure, so the list, the new-program page and tests agree.
 */
export interface ProgramAvailability {
  test: boolean
  live: boolean
  /** Why a live program is not offered. `null` when it is. */
  liveBlockedBy: "plan" | "limit" | null
  /** Payment is past due beyond grace: nothing can be created. */
  restricted: boolean
  /**
   * A limit is in the way and a bigger plan lifts it: the cheapest such plan,
   * for the upgrade notice. `null` when nothing is blocked by a limit.
   */
  upgradeTo: PlanCode | null
}

export function programAvailability(entitlements: Entitlements, usage: PlanUsage): ProgramAvailability {
  const { limits, features } = entitlements.capabilities
  const restricted = !entitlements.canCreate

  const testFits = fitsLimit(limits.testPrograms, usage.testPrograms)
  const liveFits = fitsLimit(limits.livePrograms, usage.livePrograms)

  const test = !restricted && testFits
  const live = !restricted && features.liveMode && liveFits
  const liveBlockedBy = live ? null : features.liveMode || restricted ? "limit" : "plan"

  // The notice speaks about a reached limit. A plan without live mode is told
  // so by the form itself; a Sandbox workspace at its test limit still hears
  // about the plan that has more programs.
  const blockedLimit = !testFits ? "testPrograms" : features.liveMode && !liveFits ? "livePrograms" : null
  const upgradeTo =
    restricted || !blockedLimit
      ? null
      : cheapestPlanForLimit(blockedLimit, usage[blockedLimit] + 1)

  return { test, live, liveBlockedBy: restricted ? null : liveBlockedBy, restricted, upgradeTo }
}
