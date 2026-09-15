/**
 * What each plan includes — the single definition used by enforcement
 * (`server/services/plans.ts`), the Settings usage panel and the pricing page,
 * so what is sold and what is enforced cannot drift. Framework-free and pure.
 *
 * There is no self-serve checkout: a workspace starts on `starter`, a founder
 * requests `growth`, and the operator changes `workspaces.plan`.
 */
export const PLAN_KEYS = ["starter", "growth"] as const
export type PlanKey = (typeof PLAN_KEYS)[number]

export type PlanResource = "programs" | "affiliates" | "members"
export type PlanFeature = "customRates" | "teamInvites" | "auditLog"

interface PlanDefinition {
  /** `null` = unlimited. Members counts people in the workspace plus pending invites. */
  limits: Record<PlanResource, number | null>
  features: Record<PlanFeature, boolean>
}

export const PLANS: Record<PlanKey, PlanDefinition> = {
  starter: {
    limits: { programs: 1, affiliates: 10, members: 1 },
    features: { customRates: false, teamInvites: false, auditLog: false },
  },
  growth: {
    limits: { programs: null, affiliates: null, members: 10 },
    features: { customRates: true, teamInvites: true, auditLog: true },
  },
}

export function planLimit(plan: PlanKey, resource: PlanResource): number | null {
  return PLANS[plan].limits[resource]
}

/** Whether `adding` more of `resource` fits, given what already exists. */
export function fitsPlan(plan: PlanKey, resource: PlanResource, current: number, adding = 1): boolean {
  const limit = planLimit(plan, resource)
  return limit === null || current + adding <= limit
}

export function hasPlanFeature(plan: PlanKey, feature: PlanFeature): boolean {
  return PLANS[plan].features[feature]
}

/** The cheapest plan that includes a feature — what an upgrade prompt offers. */
export function planWithFeature(feature: PlanFeature): PlanKey {
  return PLAN_KEYS.find((key) => PLANS[key].features[feature]) ?? "growth"
}

export const PLAN_RESOURCES = ["programs", "affiliates", "members"] as const satisfies readonly PlanResource[]
export const PLAN_FEATURES = ["customRates", "teamInvites", "auditLog"] as const satisfies readonly PlanFeature[]

/**
 * One line of "what this plan includes", in display order: every limit (with
 * `null` for unlimited), then every gated feature with whether it is in. The
 * pricing page and the Settings panel both render this, so a line can only say
 * what `PLANS` enforces.
 */
export type PlanLine =
  | { kind: "limit"; resource: PlanResource; limit: number | null }
  | { kind: "feature"; feature: PlanFeature; included: boolean }

export function planLines(plan: PlanKey): PlanLine[] {
  return [
    ...PLAN_RESOURCES.map((resource) => ({ kind: "limit" as const, resource, limit: planLimit(plan, resource) })),
    ...PLAN_FEATURES.map((feature) => ({
      kind: "feature" as const,
      feature,
      included: hasPlanFeature(plan, feature),
    })),
  ]
}

/** The next plan up, or `null` on the highest one. */
export function nextPlan(plan: PlanKey): PlanKey | null {
  return PLAN_KEYS[PLAN_KEYS.indexOf(plan) + 1] ?? null
}

/** The lines of `to` that are better than on `from` — what an upgrade adds. */
export function upgradeLines(from: PlanKey, to: PlanKey): PlanLine[] {
  const current = planLines(from)
  return planLines(to).filter((line, index) => {
    const before = current[index]
    if (line.kind === "limit" && before?.kind === "limit") return line.limit !== before.limit
    if (line.kind === "feature" && before?.kind === "feature") return line.included && !before.included
    return true
  })
}
