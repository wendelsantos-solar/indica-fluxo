import type { Formatters } from "@/lib/money"

/**
 * `commissions.rule_applied` is the engine's trace of the rule, written in a
 * fixed machine format by `describeRule` / `calculateReversal` in
 * `src/server/domain/commission.ts` ("30% · 12 months · program rule",
 * "partial refund: 2450/4900 of base refunded"). It is ledger data and stays as
 * written; this turns it into a structured rule the views translate. An
 * unrecognised trace yields `null` and is not shown, rather than leaking
 * English into a localised page.
 */
export type RuleApplied =
  | {
      kind: "rule"
      rate: { type: "percentage"; percent: number } | { type: "flat"; amountMinor: number }
      duration: { type: "lifetime" } | { type: "firstPayment" } | { type: "months"; months: number }
      source: "program" | "affiliate"
    }
  | {
      kind: "reversal"
      cause: "refund" | "chargeback"
      scope: "full" | "partial" | "final"
      refundedMinor: number | null
      baseMinor: number | null
    }

const RULE = /^(?:(\d+(?:\.\d+)?)%|(\d+) minor units flat) · (lifetime|first payment only|(\d+) months) · (program rule|affiliate override)$/
const FULL = /^full (refund|chargeback) of [A-Z]{3} transaction$/
const PROPORTIONAL = /^(partial|final) (refund|chargeback): (\d+)\/(\d+) of base refunded$/

export function parseRuleApplied(text: string | null | undefined): RuleApplied | null {
  if (!text) return null

  const rule = RULE.exec(text)
  if (rule) {
    const [, percent, flat, duration, months, source] = rule
    return {
      kind: "rule",
      rate: percent !== undefined ? { type: "percentage", percent: Number(percent) } : { type: "flat", amountMinor: Number(flat) },
      duration:
        duration === "lifetime"
          ? { type: "lifetime" }
          : duration === "first payment only"
            ? { type: "firstPayment" }
            : { type: "months", months: Number(months) },
      source: source === "affiliate override" ? "affiliate" : "program",
    }
  }

  const full = FULL.exec(text)
  if (full) {
    return { kind: "reversal", cause: full[1] as "refund" | "chargeback", scope: "full", refundedMinor: null, baseMinor: null }
  }

  const proportional = PROPORTIONAL.exec(text)
  if (proportional) {
    return {
      kind: "reversal",
      cause: proportional[2] as "refund" | "chargeback",
      scope: proportional[1] as "partial" | "final",
      refundedMinor: Number(proportional[3]),
      baseMinor: Number(proportional[4]),
    }
  }

  return null
}

type Translate = (key: string, values?: Record<string, string | number>) => string

/** A sentence for the rule, via the `common.rule` messages. */
export function describeRuleApplied(
  text: string | null | undefined,
  currency: string,
  f: Formatters,
  t: Translate,
): string | null {
  const rule = parseRuleApplied(text)
  if (!rule) return null

  if (rule.kind === "reversal") {
    const cause = t(`cause.${rule.cause}`)
    if (rule.scope === "full" || rule.refundedMinor === null || rule.baseMinor === null) {
      return t("reversal.full", { cause })
    }
    return t(`reversal.${rule.scope}`, {
      cause,
      refunded: f.money(rule.refundedMinor, currency),
      base: f.money(rule.baseMinor, currency),
    })
  }

  const rate =
    rule.rate.type === "percentage"
      ? f.basisPoints(Math.round(rule.rate.percent * 100))
      : f.money(rule.rate.amountMinor, currency)
  const duration =
    rule.duration.type === "months"
      ? t("duration.months", { count: rule.duration.months })
      : t(`duration.${rule.duration.type}`)
  return t("summary", { rate, duration, source: t(`source.${rule.source}`) })
}
