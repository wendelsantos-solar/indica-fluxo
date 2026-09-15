/**
 * Which side of the ledger the founder dashboard shows. Test and live data are
 * never mixed on one screen (docs/PLANS.md §2): every workspace read takes the
 * environment, and a Live / Test switch in the shell chooses it. Pure, so the
 * rule is unit-tested; the cookie is read in `server/services/view-environment.ts`.
 */

export const VIEW_ENVIRONMENTS = ["live", "test"] as const
export type ViewEnvironment = (typeof VIEW_ENVIRONMENTS)[number]

/** One cookie per workspace, so two workspaces open in two tabs keep their own view. */
export function viewEnvironmentCookie(workspaceId: string): string {
  return `if_env_${workspaceId}`
}

export const VIEW_ENVIRONMENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

export function parseViewEnvironment(value: unknown): ViewEnvironment | null {
  return value === "live" || value === "test" ? value : null
}

export interface ResolvedViewEnvironment {
  environment: ViewEnvironment
  /**
   * Whether the reader can switch. False for a Sandbox workspace with no live
   * data: it only has Test, and the shell shows a badge instead of a switch.
   */
  switchable: boolean
}

/**
 * - A workspace without live mode and without live programs (Sandbox) only has
 *   Test, whatever the cookie says.
 * - A workspace without live mode that still holds live programs (downgraded,
 *   or marked live by migration 0010) keeps its live data readable: nothing is
 *   hidden on downgrade (docs/PLANS.md §6), so it can switch.
 * - Otherwise the reader's choice, and Live by default.
 */
export function resolveViewEnvironment({
  requested,
  liveModeAvailable,
  hasLivePrograms,
}: {
  requested: unknown
  liveModeAvailable: boolean
  hasLivePrograms: boolean
}): ResolvedViewEnvironment {
  if (!liveModeAvailable && !hasLivePrograms) return { environment: "test", switchable: false }
  return { environment: parseViewEnvironment(requested) ?? "live", switchable: true }
}
