import type { Locale } from "@/i18n/routing"

/**
 * Prices are per-locale amounts in minor units, not one number converted at
 * render time: a Brazilian plan is priced in reais as a commercial decision,
 * not as today's exchange rate applied to a dollar figure. Shared by the
 * pricing page and the landing's pricing preview so the two cannot disagree.
 */
export const PRICE_MINOR: Record<Locale, Record<PlanKey, number>> = {
  "pt-br": { starter: 0, growth: 19700, scale: 59700 },
  en: { starter: 0, growth: 4900, scale: 14900 },
}

export type PlanKey = "starter" | "growth" | "scale"

export const PLANS = [
  { key: "starter", featured: false, features: ["programs", "affiliates", "tracking", "ledger", "payouts"] },
  { key: "growth", featured: true, features: ["programs", "affiliates", "rates", "batches", "team"] },
  { key: "scale", featured: false, features: ["everything", "workspaces", "support", "retention", "onboarding"] },
] as const
