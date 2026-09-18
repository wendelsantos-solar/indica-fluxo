import { describe, expect, it } from "vitest"

import { applyBasisPoints, roundHalfUp } from "@/lib/money"

import { calculateCommission } from "../commission"
import { AT, attribution, participation, program, transaction } from "./fixtures"

/** Fixed clock: these rules are about the payment date, never about today. */
const NOW = AT("2026-09-01T12:00:00Z")

/**
 * The financial rules the public guide states, pinned as a contract. Each case
 * here is a sentence a founder can read in the integration guide: if the code
 * stops behaving this way, either the code is wrong or the guide has to change
 * — the audit (DOCS_IMPLEMENTATION_AUDIT.md) must not be able to drift back.
 *
 * Pure functions only: these run in every `pnpm test`, unlike the `.db` suites.
 */

/** The reference the guide's "meio para cima" claim is measured against. */
function exactHalfUp(amountMinor: bigint, basisPoints: bigint): bigint {
  // `2ab + d` over `2d`: integer half-up, the same shape `proportionHalfUp`
  // uses. BigInt literals are out of reach at this TS target, hence BigInt().
  const numerator = amountMinor * basisPoints * BigInt(2) + BigInt(10_000)
  return numerator / BigInt(20_000)
}

describe("rounding is half-up, away from zero", () => {
  it("rounds a midpoint up", () => {
    // 4901 × 3000 / 10000 = 1470.3 → 1470; 4905 × 3000 = 1471.5 → 1472
    expect(applyBasisPoints(4901, 3000)).toBe(1470)
    expect(applyBasisPoints(4905, 3000)).toBe(1472)
  })

  it("rounds a negative midpoint away from zero, not toward +∞", () => {
    expect(roundHalfUp(-2.5)).toBe(-3)
    expect(roundHalfUp(2.5)).toBe(3)
  })

  it("matches exact integer arithmetic for every amount up to a cent-precise sweep", () => {
    for (const bps of [1, 7, 250, 3000, 10_000]) {
      for (let amount = 0; amount < 2000; amount += 7) {
        expect(BigInt(applyBasisPoints(amount, bps)), `${amount}×${bps}`).toBe(
          exactHalfUp(BigInt(amount), BigInt(bps)),
        )
      }
    }
  })

  it("is exact for amounts far above a normal SaaS payment", () => {
    // R$ 9.999.999,99 at 30%.
    expect(BigInt(applyBasisPoints(999_999_999, 3000))).toBe(exactHalfUp(BigInt(999_999_999), BigInt(3000)))
  })
})

describe("the guide's worked example", () => {
  it("4900 × 3000 bps = 1470, recorded on the commission", () => {
    const result = calculateCommission({
      program: program(),
      participation: participation(),
      transaction: transaction(),
      attribution: attribution(),
      now: NOW,
    })
    expect(result.kind).toBe("commission")
    if (result.kind !== "commission") return
    expect(result.baseAmountMinor).toBe(4900)
    expect(result.commissionRate).toBe(3000)
    expect(result.commissionAmountMinor).toBe(1470)
  })
})

describe("the conditions the guide lists", () => {
  const base = {
    program: program(),
    participation: participation(),
    transaction: transaction(),
    attribution: attribution(),
    now: NOW,
  }

  it("an unapproved participation earns nothing", () => {
    const result = calculateCommission({ ...base, participation: participation({ status: "pending" }) })
    expect(result.kind).toBe("skipped")
  })

  it("a payment in another currency earns nothing", () => {
    const result = calculateCommission({ ...base, transaction: transaction({ currency: "BRL" }) })
    expect(result.kind).toBe("skipped")
  })

  it("the currency comparison ignores case", () => {
    const result = calculateCommission({ ...base, transaction: transaction({ currency: "usd" }) })
    expect(result.kind).toBe("commission")
  })

  it("a zero-amount payment earns nothing", () => {
    const result = calculateCommission({ ...base, transaction: transaction({ grossAmountMinor: 0 }) })
    expect(result.kind).toBe("skipped")
  })

  it("a first payment after the window earns nothing", () => {
    const result = calculateCommission({
      ...base,
      transaction: transaction({ occurredAt: AT("2026-10-20T10:00:00Z") }),
    })
    expect(result.kind).toBe("skipped")
  })

  it("a renewal inside the duration earns a commission even after the window closed", () => {
    const result = calculateCommission({
      ...base,
      transaction: transaction({ occurredAt: AT("2026-11-20T10:00:00Z") }),
      attribution: attribution({ firstCommissionedAt: AT("2026-09-01T10:00:00Z") }),
    })
    expect(result.kind).toBe("commission")
  })
})

describe("flat-amount programs", () => {
  const flat = program({ commissionType: "fixed", commissionValue: 1500 })

  it("store an empty rate and pay the flat amount", () => {
    const result = calculateCommission({
      program: flat,
      participation: participation(),
      transaction: transaction(),
      attribution: attribution(),
      now: NOW,
    })
    expect(result.kind).toBe("commission")
    if (result.kind !== "commission") return
    expect(result.commissionRate).toBeNull()
    expect(result.commissionAmountMinor).toBe(1500)
  })

  it("pay the flat amount even when it exceeds the payment (documented since the audit)", () => {
    const result = calculateCommission({
      program: flat,
      participation: participation(),
      transaction: transaction({ grossAmountMinor: 500 }),
      attribution: attribution(),
      now: NOW,
    })
    expect(result.kind).toBe("commission")
    if (result.kind !== "commission") return
    expect(result.commissionAmountMinor).toBe(1500)
  })
})

describe("hold period", () => {
  it("counts from the payment date, not from now", () => {
    const result = calculateCommission({
      program: program({ commissionHoldDays: 30 }),
      participation: participation(),
      transaction: transaction({ occurredAt: AT("2026-09-01T10:00:00Z") }),
      attribution: attribution(),
      now: NOW,
    })
    expect(result.kind).toBe("commission")
    if (result.kind !== "commission") return
    expect(result.eligibleAt.toISOString()).toBe("2026-10-01T10:00:00.000Z")
  })

  it("a hold of 0 makes the commission eligible at the payment instant", () => {
    const occurredAt = AT("2026-09-01T10:00:00Z")
    const result = calculateCommission({
      program: program({ commissionHoldDays: 0 }),
      participation: participation(),
      transaction: transaction({ occurredAt }),
      attribution: attribution(),
      now: NOW,
    })
    expect(result.kind).toBe("commission")
    if (result.kind !== "commission") return
    expect(result.eligibleAt.getTime()).toBe(occurredAt.getTime())
  })
})
