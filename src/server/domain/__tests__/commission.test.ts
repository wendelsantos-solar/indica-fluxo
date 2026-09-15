import { describe, expect, it } from "vitest"

import {
  calculateCommission,
  effectiveCommissionStatus,
  isWithinRecurrenceWindow,
  planReversal,
  proportionHalfUp,
  resolveRate,
  type CommissionOutcome,
} from "../commission"
import { parseRuleApplied } from "@/features/conversions/rule-applied"

import { AT, attribution, participation, program, transaction } from "./fixtures"

const NOW = AT("2026-09-01T12:00:00Z")

function run(input: Partial<Parameters<typeof calculateCommission>[0]> = {}) {
  return calculateCommission({
    program: program(),
    participation: participation(),
    transaction: transaction(),
    attribution: attribution(),
    now: NOW,
    ...input,
  })
}

function outcome(result: ReturnType<typeof calculateCommission>): CommissionOutcome {
  if (result.kind === "skipped") {
    throw new Error(`expected a commission, got skip: ${result.reason} — ${result.detail}`)
  }
  return result
}

describe("percentage commission", () => {
  it("computes 30% of $49.00 as $14.70", () => {
    const result = outcome(run())
    expect(result.commissionAmountMinor).toBe(1470)
    expect(result.baseAmountMinor).toBe(4900)
    expect(result.commissionRate).toBe(3000)
    expect(result.currency).toBe("USD")
  })

  it("rounds half-up on the minor unit", () => {
    // 33.33% of $10.00 = 333.3 -> 333 ; 33.35% of $10.00 = 333.5 -> 334
    expect(
      outcome(run({ program: program({ commissionValue: 3333 }), transaction: transaction({ grossAmountMinor: 1000 }) }))
        .commissionAmountMinor,
    ).toBe(333)
    expect(
      outcome(run({ program: program({ commissionValue: 3335 }), transaction: transaction({ grossAmountMinor: 1000 }) }))
        .commissionAmountMinor,
    ).toBe(334)
  })

  it("never produces a fractional minor unit", () => {
    // 30% of a single minor unit legitimately rounds to zero, which the engine
    // reports as a skip rather than a $0.00 ledger row; start above that floor.
    for (const gross of [17, 99, 4900, 123457]) {
      const result = outcome(run({ transaction: transaction({ grossAmountMinor: gross }) }))
      expect(Number.isInteger(result.commissionAmountMinor)).toBe(true)
    }
  })
})

describe("fixed commission", () => {
  it("pays a flat amount regardless of the transaction size", () => {
    const fixed = program({ commissionType: "fixed", commissionValue: 1000 })
    expect(outcome(run({ program: fixed })).commissionAmountMinor).toBe(1000)
    expect(
      outcome(run({ program: fixed, transaction: transaction({ grossAmountMinor: 99_000 }) }))
        .commissionAmountMinor,
    ).toBe(1000)
  })

  it("reports no rate for a fixed rule", () => {
    const result = outcome(run({ program: program({ commissionType: "fixed", commissionValue: 1000 }) }))
    expect(result.commissionRate).toBeNull()
  })
})

describe("affiliate override", () => {
  it("prefers the affiliate rate over the program rate", () => {
    const vip = participation({ customCommissionType: "percentage", customCommissionValue: 4000 })
    const result = outcome(run({ participation: vip }))
    expect(result.commissionAmountMinor).toBe(1960) // 40% of $49
    expect(result.ruleApplied).toContain("affiliate override")
  })

  it("falls back to the program rate when only one override field is set", () => {
    const rate = resolveRate(program(), participation({ customCommissionValue: 4000 }))
    expect(rate.source).toBe("program")
    expect(rate.value).toBe(3000)
  })
})

describe("recurrence", () => {
  it("pays the first payment when no prior commission exists", () => {
    expect(isWithinRecurrenceWindow(program(), attribution(), AT("2026-09-01T00:00:00Z"))).toBe(true)
  })

  it("pays inside a 12-month window", () => {
    const attr = attribution({ firstCommissionedAt: AT("2026-01-15T00:00:00Z") })
    expect(isWithinRecurrenceWindow(program(), attr, AT("2026-12-15T00:00:00Z"))).toBe(true)
  })

  it("stops after the window closes", () => {
    const attr = attribution({ firstCommissionedAt: AT("2025-01-15T00:00:00Z") })
    const result = run({
      attribution: attr,
      transaction: transaction({ occurredAt: AT("2026-03-15T00:00:00Z") }),
    })
    expect(result.kind).toBe("skipped")
    if (result.kind === "skipped") expect(result.reason).toBe("recurrence_window_closed")
  })

  it("treats duration 1 as first payment only", () => {
    const firstOnly = program({ commissionDurationMonths: 1 })
    const attr = attribution({ firstCommissionedAt: AT("2026-08-01T00:00:00Z") })
    const result = run({ program: firstOnly, attribution: attr })
    expect(result.kind).toBe("skipped")
    if (result.kind === "skipped") expect(result.reason).toBe("recurrence_window_closed")
  })

  it("treats null duration as lifetime", () => {
    const lifetime = program({ commissionDurationMonths: null })
    const attr = attribution({ firstCommissionedAt: AT("2019-01-01T00:00:00Z") })
    expect(outcome(run({ program: lifetime, attribution: attr })).commissionAmountMinor).toBe(1470)
  })

  /**
   * The attribution window is a click → conversion deadline. A 60-day window
   * must not cancel a 12-month programme at month three: once the customer has
   * converted, only `commissionDurationMonths` may stop the payments.
   */
  it("keeps paying renewals after the attribution window has closed", () => {
    const converted = attribution({
      attributedAt: AT("2026-01-10T00:00:00Z"),
      expiresAt: AT("2026-03-11T00:00:00Z"), // 60 days, long gone
      firstCommissionedAt: AT("2026-01-15T00:00:00Z"),
    })
    const renewal = transaction({ occurredAt: AT("2026-09-01T10:00:00Z") }) // month 8

    expect(outcome(run({ attribution: converted, transaction: renewal })).commissionAmountMinor).toBe(
      1470,
    )
  })

  it("still stops those renewals at the end of the commission duration", () => {
    const converted = attribution({
      attributedAt: AT("2025-01-10T00:00:00Z"),
      expiresAt: AT("2025-03-11T00:00:00Z"),
      firstCommissionedAt: AT("2025-01-15T00:00:00Z"),
    })
    const renewal = transaction({ occurredAt: AT("2026-09-01T10:00:00Z") }) // month 19

    const result = run({ attribution: converted, transaction: renewal })
    expect(result.kind).toBe("skipped")
    if (result.kind === "skipped") expect(result.reason).toBe("recurrence_window_closed")
  })

  it("still refuses a first conversion that lands outside the window", () => {
    const stale = attribution({
      expiresAt: AT("2026-08-01T00:00:00Z"),
      firstCommissionedAt: null,
    })

    const result = run({ attribution: stale })
    expect(result.kind).toBe("skipped")
    if (result.kind === "skipped") expect(result.reason).toBe("attribution_expired")
  })
})

describe("hold period", () => {
  it("sets eligible_at to the transaction date plus the hold days", () => {
    const result = outcome(
      run({
        program: program({ commissionHoldDays: 14 }),
        transaction: transaction({ occurredAt: AT("2026-09-01T00:00:00Z") }),
      }),
    )
    expect(result.eligibleAt.toISOString()).toBe("2026-09-15T00:00:00.000Z")
  })

  it("promotes pending to available once eligible_at has passed", () => {
    expect(effectiveCommissionStatus("pending", AT("2026-09-01T00:00:00Z"), NOW)).toBe("available")
    expect(effectiveCommissionStatus("pending", AT("2026-12-01T00:00:00Z"), NOW)).toBe("pending")
    expect(effectiveCommissionStatus("paid", AT("2026-01-01T00:00:00Z"), NOW)).toBe("paid")
  })
})

describe("refunds", () => {
  const original = {
    id: "com_1",
    commissionAmountMinor: 1470,
    baseAmountMinor: 4900,
    currency: "USD",
  }

  it("reverses even when the participation is no longer approved", () => {
    const result = outcome(
      run({
        participation: participation({ status: "suspended" }),
        transaction: transaction({ type: "refund", grossAmountMinor: -4900 }),
        originalCommission: original,
      }),
    )
    expect(result.kind).toBe("reversal")
  })

  it("fully reverses a full refund", () => {
    const result = outcome(
      run({
        transaction: transaction({ type: "refund", grossAmountMinor: -4900 }),
        originalCommission: original,
      }),
    )
    expect(result.kind).toBe("reversal")
    expect(result.commissionAmountMinor).toBe(-1470)
    expect(result.reversalOfCommissionId).toBe("com_1")
    // The views read this trace back into words; the format is a contract.
    expect(parseRuleApplied(result.ruleApplied)).toMatchObject({ kind: "reversal", scope: "full" })
  })

  it("writes a rule trace the views can read", () => {
    const result = outcome(run())
    expect(parseRuleApplied(result.ruleApplied)).toMatchObject({ kind: "rule" })
  })

  it("reverses proportionally on a partial refund", () => {
    const result = outcome(
      run({
        transaction: transaction({ type: "refund", grossAmountMinor: -2450 }),
        originalCommission: original,
      }),
    )
    expect(result.commissionAmountMinor).toBe(-735) // half of $14.70
  })

  it("nets to zero across payment and full refund", () => {
    const payment = outcome(run())
    const refund = outcome(
      run({
        transaction: transaction({ type: "refund", grossAmountMinor: -4900 }),
        originalCommission: original,
      }),
    )
    expect(payment.commissionAmountMinor + refund.commissionAmountMinor).toBe(0)
  })

  it("treats a chargeback like a refund", () => {
    const result = outcome(
      run({
        transaction: transaction({ type: "chargeback", grossAmountMinor: -4900 }),
        originalCommission: original,
      }),
    )
    expect(result.commissionAmountMinor).toBe(-1470)
  })

  it("reverses two partial refunds cumulatively, without drift, to exactly the commission", () => {
    // 1001 commission on a 3000 base: 1/3 refunds would each round to 333.67.
    const odd = { id: "com_odd", commissionAmountMinor: 1001, baseAmountMinor: 3000, currency: "USD" }
    const first = outcome(
      run({ transaction: transaction({ type: "refund", grossAmountMinor: -1000 }), originalCommission: odd }),
    )
    expect(first.commissionAmountMinor).toBe(-334) // round_half_up(1001 × 1000 / 3000) = 333.67 → 334

    const second = outcome(
      run({
        transaction: transaction({ type: "refund", grossAmountMinor: -1000 }),
        originalCommission: { ...odd, refundedBeforeMinor: 1000, reversedBeforeMinor: 334 },
      }),
    )
    // Cumulative target round_half_up(1001 × 2000 / 3000) = 667 → this row 333.
    expect(second.commissionAmountMinor).toBe(-333)
    expect(second.ruleApplied).toContain("2000/3000")

    const last = outcome(
      run({
        transaction: transaction({ type: "refund", grossAmountMinor: -1000 }),
        originalCommission: { ...odd, refundedBeforeMinor: 2000, reversedBeforeMinor: 667 },
      }),
    )
    expect(last.commissionAmountMinor).toBe(-334)
    expect(first.commissionAmountMinor + second.commissionAmountMinor + last.commissionAmountMinor).toBe(-1001)
  })

  it("never reverses more than the commission when refunds exceed the base", () => {
    const result = outcome(
      run({
        transaction: transaction({ type: "refund", grossAmountMinor: -4000 }),
        originalCommission: { ...original, refundedBeforeMinor: 2450, reversedBeforeMinor: 735 },
      }),
    )
    expect(result.commissionAmountMinor).toBe(-735)
  })

  it("skips a refund that leaves nothing more to reverse", () => {
    const result = run({
      transaction: transaction({ type: "refund", grossAmountMinor: -100 }),
      originalCommission: { ...original, refundedBeforeMinor: 4900, reversedBeforeMinor: 1470 },
    })
    expect(result.kind).toBe("skipped")
  })

  it("reverses a dispute for its disputed amount", () => {
    const result = outcome(
      run({
        transaction: transaction({ type: "chargeback", grossAmountMinor: -2450 }),
        originalCommission: original,
      }),
    )
    expect(result.commissionAmountMinor).toBe(-735)
  })

  it("skips when there is nothing to reverse", () => {
    const result = run({ transaction: transaction({ type: "refund", grossAmountMinor: -4900 }) })
    expect(result.kind).toBe("skipped")
    if (result.kind === "skipped") expect(result.reason).toBe("no_original_commission")
  })
})

describe("guards", () => {
  it("refuses an unapproved participation", () => {
    const result = run({ participation: participation({ status: "pending" }) })
    expect(result.kind).toBe("skipped")
    if (result.kind === "skipped") expect(result.reason).toBe("participation_not_approved")
  })

  it("refuses an expired attribution", () => {
    const result = run({ attribution: attribution({ expiresAt: AT("2026-08-01T00:00:00Z") }) })
    expect(result.kind).toBe("skipped")
    if (result.kind === "skipped") expect(result.reason).toBe("attribution_expired")
  })

  it("refuses a currency mismatch rather than converting", () => {
    const result = run({ transaction: transaction({ currency: "EUR" }) })
    expect(result.kind).toBe("skipped")
    if (result.kind === "skipped") expect(result.reason).toBe("currency_mismatch")
  })

  it("refuses a zero-amount transaction", () => {
    const result = run({ transaction: transaction({ grossAmountMinor: 0 }) })
    expect(result.kind).toBe("skipped")
    if (result.kind === "skipped") expect(result.reason).toBe("zero_amount")
  })
})

describe("proportionHalfUp", () => {
  it("rounds half up with exact integer math", () => {
    expect(proportionHalfUp(1470, 2450, 4900)).toBe(735)
    expect(proportionHalfUp(1001, 1000, 3000)).toBe(334) // 333.67
    expect(proportionHalfUp(3, 1, 2)).toBe(2) // 1.5 → 2
    expect(proportionHalfUp(1, 1, 3)).toBe(0) // 0.33 → 0
  })

  it("stays exact beyond 2^53 intermediate products", () => {
    expect(proportionHalfUp(9_000_000_000, 9_000_000_000, 18_000_000_000)).toBe(4_500_000_000)
  })
})

describe("planReversal", () => {
  it("flips an unpaid original only on a full refund, settling earlier partial rows", () => {
    expect(planReversal("available", true)).toEqual({
      rowStatus: "reversed",
      rowEligibleAt: "now",
      flipOriginal: true,
      settlePriorReversals: true,
    })
  })

  it("keeps the original's status on a partial refund and adds a row a payout nets", () => {
    expect(planReversal("available", false)).toMatchObject({ rowStatus: "available", flipOriginal: false })
    expect(planReversal("approved", false)).toMatchObject({ rowStatus: "available", flipOriginal: false })
    expect(planReversal("pending", false)).toMatchObject({
      rowStatus: "pending",
      rowEligibleAt: "original",
      flipOriginal: false,
    })
  })

  it("never rewrites a paid commission, full or partial", () => {
    for (const full of [true, false]) {
      expect(planReversal("paid", full)).toEqual({
        rowStatus: "reversed",
        rowEligibleAt: "now",
        flipOriginal: false,
        settlePriorReversals: false,
      })
    }
  })
})
