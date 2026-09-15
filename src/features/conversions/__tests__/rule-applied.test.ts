import { describe, expect, it } from "vitest"

import { parseRuleApplied } from "../rule-applied"

describe("parseRuleApplied", () => {
  it("reads a percentage program rule", () => {
    expect(parseRuleApplied("30% · 12 months · program rule")).toEqual({
      kind: "rule",
      rate: { type: "percentage", percent: 30 },
      duration: { type: "months", months: 12 },
      source: "program",
    })
  })

  it("reads a flat affiliate override for the first payment", () => {
    expect(parseRuleApplied("5000 minor units flat · first payment only · affiliate override")).toEqual({
      kind: "rule",
      rate: { type: "flat", amountMinor: 5000 },
      duration: { type: "firstPayment" },
      source: "affiliate",
    })
  })

  it("reads fractional percentages and lifetime", () => {
    const rule = parseRuleApplied("25.5% · lifetime · program rule")
    expect(rule).toMatchObject({ rate: { percent: 25.5 }, duration: { type: "lifetime" } })
  })

  it("reads reversals", () => {
    expect(parseRuleApplied("full refund of BRL transaction")).toMatchObject({ kind: "reversal", scope: "full", cause: "refund" })
    expect(parseRuleApplied("partial chargeback: 2450/4900 of base refunded")).toEqual({
      kind: "reversal",
      cause: "chargeback",
      scope: "partial",
      refundedMinor: 2450,
      baseMinor: 4900,
    })
  })

  it("returns null for anything else", () => {
    expect(parseRuleApplied("manual adjustment by support")).toBeNull()
    expect(parseRuleApplied(null)).toBeNull()
  })
})
