import { describe, expect, it } from "vitest"

import { applyBasisPoints, formatBasisPoints, formatMoney, roundHalfUp } from "../money"

describe("roundHalfUp", () => {
  it("rounds .5 away from zero in both directions", () => {
    expect(roundHalfUp(2.5)).toBe(3)
    expect(roundHalfUp(-2.5)).toBe(-3)
    expect(roundHalfUp(2.4)).toBe(2)
    expect(roundHalfUp(-2.4)).toBe(-2)
  })
})

describe("applyBasisPoints", () => {
  it("computes the worked example from the spec", () => {
    expect(applyBasisPoints(4900, 3000)).toBe(1470)
  })

  it("is exact for values that would drift as floats", () => {
    expect(applyBasisPoints(1999, 1000)).toBe(200)
    expect(applyBasisPoints(1000, 3333)).toBe(333)
  })
})

describe("formatMoney", () => {
  it("renders minor units as currency", () => {
    expect(formatMoney(1470, "USD")).toBe("$14.70")
    expect(formatMoney(-1470, "USD")).toBe("-$14.70")
  })

  it("respects zero-decimal currencies", () => {
    expect(formatMoney(4900, "JPY")).toBe("¥4,900")
  })
})

describe("formatBasisPoints", () => {
  it("renders whole and fractional percentages", () => {
    expect(formatBasisPoints(3000)).toBe("30%")
    expect(formatBasisPoints(2550)).toBe("25.5%")
  })
})
