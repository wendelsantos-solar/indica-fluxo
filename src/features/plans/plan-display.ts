/**
 * What Settings → "Plano e cobrança" and the upgrade prompts show, derived
 * from `src/lib/plans.ts` and the billing read model. Pure and framework-free,
 * so the wording decisions (which status, which plan to offer, which meter is
 * over) are unit-tested rather than eyeballed. Words live in the catalogues.
 */

import {
  cheapestPlanForLimit,
  cheapestPlanWithFeature,
  fitsLimit,
  PLAN_CAPABILITIES,
  PLAN_LIMITS,
  PLAN_OFFERS,
  PURCHASABLE_PLANS,
  planHasFeature,
  planLimit,
  planRank,
  type PlanCode,
  type PlanFeature,
  type PlanLimit,
} from "@/lib/plans"
import type { PlatformSubscriptionStatus, Standing } from "@/server/domain/entitlements"

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type BillingStatusKey = "sandbox" | "active" | "trialing" | "grace" | "restricted" | "cancelling"

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral"

export interface BillingStatusLabel {
  key: BillingStatusKey
  tone: StatusTone
  /** The date the label names: grace end, cancellation, trial end. */
  date: Date | null
}

/**
 * One label for the plan's state (docs/PLANS.md §6). Precedence: a payment
 * problem outranks a scheduled cancellation, which outranks a trial.
 */
export function billingStatusLabel(input: {
  standing: Standing
  status: PlatformSubscriptionStatus
  endsAt: Date | null
  graceEndsAt: Date | null
  trialEndsAt: Date | null
}): BillingStatusLabel {
  switch (input.standing) {
    case "sandbox":
      return { key: "sandbox", tone: "neutral", date: null }
    case "restricted":
      return { key: "restricted", tone: "danger", date: null }
    case "grace":
      return { key: "grace", tone: "warning", date: input.graceEndsAt }
    case "active":
      if (input.endsAt) return { key: "cancelling", tone: "warning", date: input.endsAt }
      if (input.status === "trialing") return { key: "trialing", tone: "info", date: input.trialEndsAt }
      return { key: "active", tone: "success", date: null }
  }
}

// ---------------------------------------------------------------------------
// Usage meters
// ---------------------------------------------------------------------------

/**
 * - `within`      — room left (or unlimited)
 * - `atLimit`     — full: the next one is refused
 * - `over`        — above the limit (after a downgrade): nothing deleted, nothing new
 * - `unavailable` — the plan allows none of it (Sandbox live programs)
 */
export type UsageState = "within" | "atLimit" | "over" | "unavailable"

export interface UsageMeter {
  limit: PlanLimit
  used: number
  /** `null` = unlimited. */
  max: number | null
  state: UsageState
}

export function usageMeters(usage: Record<PlanLimit, number>, limits: Record<PlanLimit, number | null>): UsageMeter[] {
  return PLAN_LIMITS.map((limit) => {
    const used = usage[limit]
    const max = limits[limit]
    const state: UsageState =
      max === null
        ? "within"
        : used > max
          ? "over"
          : max === 0
            ? "unavailable"
            : used === max
              ? "atLimit"
              : "within"
    return { limit, used, max, state }
  })
}

/**
 * Catalogue key and values for a meter's figure: "38 / 100" when limited, the
 * count alone ("391") when unlimited. `usageUnavailable` when the plan allows none.
 */
export function usageValue(
  meter: UsageMeter,
): { key: "usageOf"; values: { used: number; limit: number } } | { key: "usageCount"; values: { used: number } } | { key: "usageUnavailable"; values: Record<string, never> } {
  if (meter.state === "unavailable") return { key: "usageUnavailable", values: {} }
  if (meter.max === null) return { key: "usageCount", values: { used: meter.used } }
  return { key: "usageOf", values: { used: meter.used, limit: meter.max } }
}

// ---------------------------------------------------------------------------
// Upgrade offers
// ---------------------------------------------------------------------------

/** What an upgrade prompt can be about: a limit or a feature. */
export type UpgradeReason = PlanLimit | PlanFeature

export function isPlanLimit(reason: UpgradeReason): reason is PlanLimit {
  return (PLAN_LIMITS as readonly string[]).includes(reason)
}

export interface UpgradeOffer {
  plan: PlanCode
  /** Monthly price in minor units, `null` when not priced. */
  priceMonthlyMinor: number | null
  currency: "BRL"
}

function offerFor(plan: PlanCode): UpgradeOffer {
  return { plan, priceMonthlyMinor: PLAN_OFFERS[plan].priceMonthlyMinor, currency: PLAN_OFFERS[plan].currency }
}

function isPlanCode(value: unknown): value is PlanCode {
  return typeof value === "string" && value in PLAN_CAPABILITIES
}

/**
 * The plan an upgrade prompt offers, and its price.
 *
 * - `upgradeTo` (from a `PLAN_LIMIT_REACHED` / `FEATURE_NOT_AVAILABLE` error)
 *   wins when it is purchasable and above the current plan.
 * - Without a current plan: `cheapestPlanWithFeature` / `cheapestPlanForLimit`.
 * - With one: the cheapest purchasable plan above it that fits `needed`
 *   (default: one more than the current plan allows).
 *
 * `null` when no purchasable plan would help (Growth's 10 members, say).
 */
export function upgradeOffer(
  reason: UpgradeReason,
  options: { currentPlan?: PlanCode; needed?: number; upgradeTo?: string | null } = {},
): UpgradeOffer | null {
  const { currentPlan, upgradeTo } = options
  const above = (plan: PlanCode) => currentPlan === undefined || planRank(plan) > planRank(currentPlan)

  if (isPlanCode(upgradeTo) && PLAN_OFFERS[upgradeTo].purchasable && above(upgradeTo)) {
    return offerFor(upgradeTo)
  }

  if (!isPlanLimit(reason)) {
    if (currentPlan === undefined) {
      const plan = cheapestPlanWithFeature(reason)
      return plan ? offerFor(plan) : null
    }
    const plan = PURCHASABLE_PLANS.find((code) => above(code) && planHasFeature(code, reason))
    return plan ? offerFor(plan) : null
  }

  const needed = options.needed ?? (currentPlan ? (planLimit(currentPlan, reason) ?? 0) + 1 : 1)
  if (currentPlan === undefined) {
    const plan = cheapestPlanForLimit(reason, needed)
    return plan ? offerFor(plan) : null
  }
  const plan = PURCHASABLE_PLANS.find((code) => above(code) && fitsLimit(planLimit(code, reason), 0, needed))
  return plan ? offerFor(plan) : null
}

// ---------------------------------------------------------------------------
// Plan options in Settings
// ---------------------------------------------------------------------------

export type PlanAction =
  /** Stripe Checkout (`startCheckoutAction`). */
  | { kind: "checkout" }
  /** Stripe Billing Portal on the plan-change confirmation (`openBillingPortalAction` with `plan`). */
  | { kind: "portalChange" }
  /** Platform billing is not configured: a manual request (`requestPlanUpgradeAction`). */
  | { kind: "request" }
  /** No self-service path (plan granted manually, or a downgrade without billing): say who to talk to. */
  | { kind: "contact" }

export interface PlanOption {
  plan: PlanCode
  recommended: boolean
  /** Lower than the subscribed plan: the over-limit rule applies. */
  downgrade: boolean
  action: PlanAction
}

/**
 * The plans Settings offers next to the current one (docs/PLANS.md §5):
 * Sandbox → Launch and Growth through Checkout; Launch ↔ Growth through the
 * Billing Portal. Scale is not sold, so it is never offered.
 */
export function planOptions(billing: {
  subscribedPlan: PlanCode
  standing: Standing
  configured: boolean
  canManageBilling: boolean
  provider: "stripe" | "paddle" | "manual" | null
}): PlanOption[] {
  const subscribed = billing.standing === "sandbox" ? "sandbox" : billing.subscribedPlan

  return PURCHASABLE_PLANS.filter((plan) => plan !== subscribed && subscribed !== "scale").map((plan) => {
    const downgrade = planRank(plan) < planRank(subscribed)
    let action: PlanAction
    if (subscribed === "sandbox") {
      action = billing.configured ? { kind: "checkout" } : { kind: "request" }
    } else if (billing.configured && billing.provider === "stripe" && billing.canManageBilling) {
      action = { kind: "portalChange" }
    } else if (!billing.configured && !downgrade) {
      action = { kind: "request" }
    } else {
      action = { kind: "contact" }
    }
    return { plan, recommended: PLAN_OFFERS[plan].recommended, downgrade, action }
  })
}

// ---------------------------------------------------------------------------
// Capability lines
// ---------------------------------------------------------------------------

export type CapabilityLine =
  | { kind: "limit"; limit: PlanLimit; max: number | null }
  | { kind: "feature"; feature: Exclude<PlanFeature, "liveMode">; included: boolean }

/**
 * "What this plan includes", in the order a founder compares plans, straight
 * from `PLAN_CAPABILITIES`. Live mode is implied by the live-program line.
 */
export function capabilityLines(plan: PlanCode): CapabilityLine[] {
  const { limits, features } = PLAN_CAPABILITIES[plan]
  return [
    ...PLAN_LIMITS.map((limit) => ({ kind: "limit" as const, limit, max: limits[limit] })),
    { kind: "feature", feature: "customAffiliateRates", included: features.customAffiliateRates },
    { kind: "feature", feature: "auditLog", included: features.auditLog },
  ]
}
