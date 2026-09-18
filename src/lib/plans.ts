/**
 * Refvia's plans — the single source of what each plan allows and what it
 * costs. Server enforcement (`src/server/services/entitlements.ts`), the
 * Settings "Plano e cobrança" page and the public pricing all read this module,
 * so what is sold and what is enforced cannot drift. Framework-free and pure.
 *
 * Read docs/PLANS.md before changing anything here.
 *
 * Price here is what the product displays. What Stripe charges is the Price
 * behind `STRIPE_LAUNCH_PRICE_ID` / `STRIPE_GROWTH_PRICE_ID`; keep them equal.
 */

export const PLAN_CODES = ["sandbox", "launch", "growth", "scale"] as const
export type PlanCode = (typeof PLAN_CODES)[number]

/** Countable resources. `null` = unlimited, never a large sentinel number. */
export const PLAN_LIMITS = ["livePrograms", "testPrograms", "affiliates", "members"] as const
export type PlanLimit = (typeof PLAN_LIMITS)[number]

/** On/off capabilities. */
export const PLAN_FEATURES = ["liveMode", "customAffiliateRates", "auditLog"] as const
export type PlanFeature = (typeof PLAN_FEATURES)[number]

export interface PlanCapabilities {
  limits: Record<PlanLimit, number | null>
  features: Record<PlanFeature, boolean>
}

export const PLAN_CAPABILITIES: Record<PlanCode, PlanCapabilities> = {
  // Prove the integration works before paying: test data only.
  sandbox: {
    limits: { livePrograms: 0, testPrograms: 1, affiliates: 10, members: 1 },
    features: { liveMode: false, customAffiliateRates: false, auditLog: false },
  },
  // The whole core, in production, for one program.
  launch: {
    limits: { livePrograms: 1, testPrograms: 1, affiliates: 100, members: 2 },
    features: { liveMode: true, customAffiliateRates: false, auditLog: false },
  },
  // Scale, team and control on top of the same core.
  growth: {
    limits: { livePrograms: null, testPrograms: null, affiliates: null, members: 10 },
    features: { liveMode: true, customAffiliateRates: true, auditLog: true },
  },
  // Accepted by the model, not sold: nothing exclusive exists yet (docs/PLANS.md).
  scale: {
    limits: { livePrograms: null, testPrograms: null, affiliates: null, members: 10 },
    features: { liveMode: true, customAffiliateRates: true, auditLog: true },
  },
}

export interface PlanOffer {
  /** Shown on the pricing page and in Settings. */
  public: boolean
  /** Can be bought through checkout. */
  purchasable: boolean
  /** Monthly price in minor units of `currency`; `0` for free, `null` when not priced. */
  priceMonthlyMinor: number | null
  currency: "BRL"
  recommended: boolean
}

export const PLAN_OFFERS: Record<PlanCode, PlanOffer> = {
  sandbox: { public: true, purchasable: false, priceMonthlyMinor: 0, currency: "BRL", recommended: false },
  launch: { public: true, purchasable: true, priceMonthlyMinor: 9900, currency: "BRL", recommended: false },
  growth: { public: true, purchasable: true, priceMonthlyMinor: 19700, currency: "BRL", recommended: true },
  scale: { public: false, purchasable: false, priceMonthlyMinor: null, currency: "BRL", recommended: false },
}

/** Plans a founder can pay for, cheapest first. */
export const PURCHASABLE_PLANS = PLAN_CODES.filter((code) => PLAN_OFFERS[code].purchasable)

export function planLimit(plan: PlanCode, limit: PlanLimit): number | null {
  return PLAN_CAPABILITIES[plan].limits[limit]
}

/** Whether `adding` more fits, given what already exists. */
export function fitsLimit(limit: number | null, current: number, adding = 1): boolean {
  return limit === null || current + adding <= limit
}

export function planHasFeature(plan: PlanCode, feature: PlanFeature): boolean {
  return PLAN_CAPABILITIES[plan].features[feature]
}

/** The cheapest purchasable plan that includes `feature` — what an upgrade prompt offers. */
export function cheapestPlanWithFeature(feature: PlanFeature): PlanCode | null {
  return PURCHASABLE_PLANS.find((code) => planHasFeature(code, feature)) ?? null
}

/** The cheapest purchasable plan whose `limit` fits `needed` items. */
export function cheapestPlanForLimit(limit: PlanLimit, needed: number): PlanCode | null {
  return PURCHASABLE_PLANS.find((code) => fitsLimit(planLimit(code, limit), 0, needed)) ?? null
}

/** Rank for comparisons: a higher rank includes at least everything below it. */
export function planRank(plan: PlanCode): number {
  return PLAN_CODES.indexOf(plan)
}
