import {
  PLAN_CAPABILITIES,
  PLAN_LIMITS,
  type PlanCapabilities,
  type PlanCode,
  type PlanLimit,
} from "@/lib/plans"

/**
 * Turns a workspace's subscription row into what the workspace may do right
 * now. Pure: the clock is an argument. The rules are docs/PLANS.md §Billing
 * states; change both together.
 */

/** Days a `past_due` subscription keeps its plan before live mode stops. */
export const PAST_DUE_GRACE_DAYS = 7

const DAY_MS = 86_400_000

export type PlatformSubscriptionStatus = "free" | "trialing" | "active" | "past_due" | "cancelled" | "incomplete"

export interface SubscriptionSnapshot {
  plan: PlanCode
  status: PlatformSubscriptionStatus
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: Date | null
  pastDueSince: Date | null
}

/**
 * - `sandbox`    — no paid subscription (none, free, incomplete, cancelled, or ended).
 * - `active`     — paying or trialing.
 * - `grace`      — payment failed; the plan still applies until `graceEndsAt`.
 * - `restricted` — payment failed and grace ended: data stays readable, live
 *                  processing stops, nothing new can be created.
 */
export type Standing = "sandbox" | "active" | "grace" | "restricted"

export interface Entitlements {
  /** The plan paid for (or `sandbox`). What Settings names. */
  subscribedPlan: PlanCode
  /** The plan whose capabilities apply now. */
  plan: PlanCode
  status: PlatformSubscriptionStatus
  standing: Standing
  graceEndsAt: Date | null
  /** Subscription ends at `currentPeriodEnd` and will not renew. */
  endsAt: Date | null
  capabilities: PlanCapabilities
  /** False in `restricted`: reads only. */
  canCreate: boolean
}

export function resolveEntitlements(subscription: SubscriptionSnapshot | null, now: Date): Entitlements {
  const sandbox = (status: PlatformSubscriptionStatus = "free"): Entitlements => ({
    subscribedPlan: "sandbox",
    plan: "sandbox",
    status,
    standing: "sandbox",
    graceEndsAt: null,
    endsAt: null,
    capabilities: PLAN_CAPABILITIES.sandbox,
    canCreate: true,
  })

  if (!subscription || subscription.plan === "sandbox") return sandbox(subscription?.status)

  const { plan, status } = subscription
  if (status === "free" || status === "incomplete" || status === "cancelled") return sandbox(status)

  // A cancellation takes effect at period end. The webhook normally says so;
  // this keeps a delayed or lost `subscription.deleted` from extending a plan.
  const ended =
    subscription.cancelAtPeriodEnd &&
    subscription.currentPeriodEnd !== null &&
    subscription.currentPeriodEnd.getTime() <= now.getTime()
  if (ended) return sandbox("cancelled")

  const endsAt = subscription.cancelAtPeriodEnd ? subscription.currentPeriodEnd : null

  if (status === "past_due") {
    const since = subscription.pastDueSince ?? now
    const graceEndsAt = new Date(since.getTime() + PAST_DUE_GRACE_DAYS * DAY_MS)
    if (now.getTime() < graceEndsAt.getTime()) {
      return {
        subscribedPlan: plan,
        plan,
        status,
        standing: "grace",
        graceEndsAt,
        endsAt,
        capabilities: PLAN_CAPABILITIES[plan],
        canCreate: true,
      }
    }
    return {
      subscribedPlan: plan,
      plan,
      status,
      standing: "restricted",
      graceEndsAt,
      endsAt,
      capabilities: {
        limits: PLAN_CAPABILITIES[plan].limits,
        features: { ...PLAN_CAPABILITIES[plan].features, liveMode: false },
      },
      canCreate: false,
    }
  }

  return {
    subscribedPlan: plan,
    plan,
    status,
    standing: "active",
    graceEndsAt: null,
    endsAt,
    capabilities: PLAN_CAPABILITIES[plan],
    canCreate: true,
  }
}

export type PlanUsage = Record<PlanLimit, number>

/** Limits the workspace already exceeds — after a downgrade, say. Nothing is deleted; creating more is blocked. */
export function overLimits(entitlements: Entitlements, usage: PlanUsage): PlanLimit[] {
  return PLAN_LIMITS.filter((limit) => {
    const max = entitlements.capabilities.limits[limit]
    return max !== null && usage[limit] > max
  })
}
