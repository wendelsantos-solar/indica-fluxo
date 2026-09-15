import { formatMoney, minorUnitExponent } from "@/lib/money"
import {
  PLAN_CAPABILITIES,
  PLAN_CODES,
  PLAN_FEATURES,
  PLAN_LIMITS,
  PLAN_OFFERS,
  type PlanCode,
  type PlanFeature,
  type PlanLimit,
} from "@/lib/plans"

/**
 * How the plans are PRESENTED publicly (landing preview, pricing page). What a
 * plan allows and costs is not decided here: every line below is derived from
 * `PLAN_CAPABILITIES` and every price read from `PLAN_OFFERS`, so the pricing
 * page cannot list a limit or a feature enforcement does not apply
 * (docs/PLANS.md). This module only chooses wording keys, order and CTAs.
 *
 * Message keys are full paths (`pricing.…`), resolved with an un-namespaced
 * `getTranslations()`; both catalogues carry them.
 */

/**
 * What every plan includes because it is the product itself, not a gate —
 * each item exists in code today: tracker and referral links, first/last-click
 * attribution with a window, the identify API, the Stripe integration (test
 * and live endpoints), the commission ledger (percentage, fixed, recurring,
 * hold), refunds and disputes as reversals, the affiliate portal, payout
 * batches with CSV export, essential analytics. Never add a line here that the
 * code does not deliver on every plan.
 */
export const CORE_FEATURES = [
  "tracking",
  "attribution",
  "identify",
  "stripe",
  "ledger",
  "reversals",
  "portal",
  "payouts",
  "analytics",
] as const
export type CoreFeature = (typeof CORE_FEATURES)[number]

export type DisplayLine =
  | { kind: "limit"; limit: PlanLimit; value: number }
  | { kind: "unlimited"; limit: PlanLimit }
  | { kind: "feature"; feature: PlanFeature }
  | { kind: "core"; item: CoreFeature }
  /** First line of a pricing card: test data only, or live. */
  | { kind: "mode"; live: boolean }
  /** Live and test programs both unlimited, said once. */
  | { kind: "programsUnlimited" }

export interface LineMessage {
  key: string
  values?: Record<string, number>
}

/** The limit and feature lines a plan's capabilities justify, nothing else. */
export function capabilityLines(plan: PlanCode): DisplayLine[] {
  const { limits, features } = PLAN_CAPABILITIES[plan]
  const lines: DisplayLine[] = []

  for (const limit of PLAN_LIMITS) {
    const value = limits[limit]
    if (value === null) lines.push({ kind: "unlimited", limit })
    // A zero limit is an absence (e.g. no live programs on Sandbox), not a line.
    else if (value > 0) lines.push({ kind: "limit", limit, value })
  }

  for (const feature of PLAN_FEATURES) {
    // Only what the plan HAS is listed: no struck-through features.
    if (features[feature]) lines.push({ kind: "feature", feature })
  }

  return lines
}

export function lineId(line: DisplayLine): string {
  switch (line.kind) {
    case "limit":
      return `limit.${line.limit}.${line.value}`
    case "unlimited":
      return `unlimited.${line.limit}`
    case "feature":
      return `feature.${line.feature}`
    case "core":
      return `core.${line.item}`
    case "mode":
      return `mode.${line.live ? "live" : "test"}`
    case "programsUnlimited":
      return "programsUnlimited"
  }
}

export function lineMessage(line: DisplayLine): LineMessage {
  switch (line.kind) {
    case "limit":
      return { key: `pricing.lines.limit.${line.limit}`, values: { count: line.value } }
    case "unlimited":
      return { key: `pricing.lines.unlimited.${line.limit}` }
    case "feature":
      return { key: `pricing.lines.feature.${line.feature}` }
    case "core":
      return { key: `pricing.lines.core.${line.item}` }
    case "mode":
      return { key: `pricing.lines.mode.${line.live ? "live" : "test"}` }
    case "programsUnlimited":
      return { key: "pricing.lines.unlimited.programs" }
  }
}

/**
 * A pricing card's lines, comparable across cards: the mode (test only or
 * live), then every limit, then the features the plan adds. Live mode is the
 * mode line, not a feature line. What every plan shares (`CORE_FEATURES`) is
 * not on the cards; the page lists it once below them.
 */
export function cardLines(plan: PlanCode): DisplayLine[] {
  const { limits, features } = PLAN_CAPABILITIES[plan]
  const lines: DisplayLine[] = [{ kind: "mode", live: features.liveMode }]
  const merged = limits.livePrograms === null && limits.testPrograms === null
  for (const line of capabilityLines(plan)) {
    if (line.kind === "feature" && line.feature === "liveMode") continue
    if (merged && line.kind === "unlimited" && (line.limit === "livePrograms" || line.limit === "testPrograms")) {
      if (line.limit === "livePrograms") lines.push({ kind: "programsUnlimited" })
      continue
    }
    lines.push(line)
  }
  return lines
}

/** Plans sold on the pricing page, cheapest first. Scale (`public: false`) never appears. */
export const PUBLIC_PAID_PLANS: readonly PlanCode[] = PLAN_CODES.filter(
  (code) => PLAN_OFFERS[code].public && PLAN_OFFERS[code].purchasable,
)

/** The free starting point: public, not purchasable, priced at zero. */
export const START_PLAN: PlanCode = (() => {
  const code = PLAN_CODES.find(
    (candidate) =>
      PLAN_OFFERS[candidate].public &&
      !PLAN_OFFERS[candidate].purchasable &&
      PLAN_OFFERS[candidate].priceMonthlyMinor === 0,
  )
  if (!code) throw new Error("plans-display: no free public plan to start on")
  return code
})()

/** Every public CTA leads to sign-up: a workspace starts on Sandbox and a plan is activated in Settings. */
export const SIGNUP_HREF = "/signup" as const

export interface PlanDisplay {
  code: PlanCode
  nameKey: string
  descriptionKey: string
  cta: { key: string; href: typeof SIGNUP_HREF }
  recommended: boolean
  priceMonthlyMinor: number
  currency: string
  /** The cheaper public plan this one extends; its lines are not repeated. */
  extends: PlanCode | null
  lines: DisplayLine[]
}

function paidPlanDisplay(code: PlanCode, index: number): PlanDisplay {
  const offer = PLAN_OFFERS[code]
  if (offer.priceMonthlyMinor === null) throw new Error(`plans-display: ${code} is public but not priced`)

  const base = index > 0 ? PUBLIC_PAID_PLANS[index - 1] : null
  const own = capabilityLines(code)
  const lines = base
    ? (() => {
        const inherited = new Set(capabilityLines(base).map(lineId))
        return own.filter((line) => !inherited.has(lineId(line)))
      })()
    : [...own, ...CORE_FEATURES.map((item) => ({ kind: "core" as const, item }))]

  return {
    code,
    nameKey: `pricing.plans.${code}.name`,
    descriptionKey: `pricing.plans.${code}.description`,
    cta: { key: "pricing.cta.startFree", href: SIGNUP_HREF },
    recommended: offer.recommended,
    priceMonthlyMinor: offer.priceMonthlyMinor,
    currency: offer.currency,
    extends: base,
    lines,
  }
}

export const PAID_PLAN_DISPLAY: readonly PlanDisplay[] = PUBLIC_PAID_PLANS.map(paidPlanDisplay)

export const START_PLAN_DISPLAY = {
  code: START_PLAN,
  nameKey: `pricing.plans.${START_PLAN}.name`,
  descriptionKey: `pricing.plans.${START_PLAN}.description`,
  cta: { key: "pricing.cta.createFreeAccount", href: SIGNUP_HREF },
  currency: PLAN_OFFERS[START_PLAN].currency,
  lines: capabilityLines(START_PLAN),
} as const

export interface PricingCard {
  code: PlanCode
  nameKey: string
  descriptionKey: string
  cta: { key: string; href: typeof SIGNUP_HREF }
  /** The one amber action on the page. */
  recommended: boolean
  priceMonthlyMinor: number
  currency: string
  lines: DisplayLine[]
}

/** The pricing page's cards: the free start, then the paid plans, cheapest first. */
export const PRICING_CARDS: readonly PricingCard[] = [START_PLAN, ...PUBLIC_PAID_PLANS].map((code) => {
  const offer = PLAN_OFFERS[code]
  return {
    code,
    nameKey: `pricing.plans.${code}.name`,
    descriptionKey: `pricing.plans.${code}.description`,
    cta: { key: offer.purchasable ? "pricing.cta.startFree" : "pricing.cta.createFreeAccount", href: SIGNUP_HREF },
    recommended: offer.recommended,
    priceMonthlyMinor: offer.priceMonthlyMinor ?? 0,
    currency: offer.currency,
    lines: cardLines(code),
  }
})

/**
 * `9900 BRL` → "R$ 99" / "R$99": a whole monthly price reads without cents; a
 * price with cents keeps them. Currency is the offer's (BRL) in every locale.
 */
export function formatPlanPrice(locale: string, amountMinor: number, currency: string): string {
  const unit = 10 ** minorUnitExponent(currency)
  // Compact notation only below 1 000, where it prints every digit ("R$ 197", not "R$ 1,2 mil").
  const whole = amountMinor % unit === 0 && amountMinor / unit < 1000
  return formatMoney(locale, amountMinor, currency, whole ? { compact: true } : {})
}
