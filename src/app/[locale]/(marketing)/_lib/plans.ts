import type { Locale } from "@/i18n/routing"
import { PLAN_KEYS, planLines, type PlanKey, type PlanLine } from "@/lib/plans"

/**
 * Prices are per-locale amounts in minor units, not one number converted at
 * render time: a Brazilian plan is priced in reais as a commercial decision,
 * not as today's exchange rate applied to a dollar figure. Shared by the
 * pricing page and the landing's pricing preview so the two cannot disagree.
 *
 * There is no checkout. The price is what the team agrees with a founder who
 * asks for Growth in Settings → Plan; nothing is charged automatically.
 */
export const PRICE_MINOR: Record<Locale, Record<PlanKey, number>> = {
  "pt-br": { starter: 0, growth: 19700 },
  en: { starter: 0, growth: 4900 },
}

/**
 * What every plan includes because it is the product itself, not a gate. Each
 * item exists in the code today: the Stripe adapter, click tracking and
 * attribution, the commission ledger (hold period, reversals), payout batches
 * with CSV export, and the affiliate portal.
 */
export const BASE_ITEMS = ["stripe", "tracking", "ledger", "payouts", "portal"] as const
export type BaseItem = (typeof BASE_ITEMS)[number]

export type MarketingPlanLine = PlanLine | { kind: "base"; item: BaseItem }

/**
 * The feature list a plan card renders: its limits and gated features straight
 * from `src/lib/plans.ts` (the table enforcement reads), then the base items.
 * Nothing on the card is hand-typed per plan.
 */
export function marketingPlanLines(plan: PlanKey): MarketingPlanLine[] {
  return [...planLines(plan), ...BASE_ITEMS.map((item) => ({ kind: "base" as const, item }))]
}

export const MARKETING_PLANS: readonly { key: PlanKey; featured: boolean }[] = PLAN_KEYS.map((key) => ({
  key,
  featured: key === "growth",
}))
