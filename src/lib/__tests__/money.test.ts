import { describe, expect, it } from "vitest"

import {
  applyBasisPoints,
  createFormatters,
  formatBasisPoints,
  formatMoney,
  formatNumber,
  formatRate,
  roundHalfUp,
} from "../money"

/**
 * `Intl` separates the number from the currency symbol with U+00A0 in pt-BR.
 * Comparing against a typed space would fail for the wrong reason, so the
 * assertions below normalise every non-breaking space first.
 */
const norm = (value: string) => value.replace(/ /g, " ").replace(/ /g, " ")

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
  it("renders minor units as currency in en-US", () => {
    expect(formatMoney("en", 1470, "USD")).toBe("$14.70")
    expect(formatMoney("en", -1470, "USD")).toBe("-$14.70")
  })

  it("renders the same amount the way a Brazilian reader expects", () => {
    expect(norm(formatMoney("pt-br", 123456, "BRL"))).toBe("R$ 1.234,56")
    expect(norm(formatMoney("pt-br", 1470, "USD"))).toBe("US$ 14,70")
  })

  /**
   * The ledger's currency is a fact, not a preference. A commission recorded in
   * USD stays USD for a pt-BR reader — only the formatting changes, because
   * swapping the symbol would invent an exchange rate nobody applied.
   */
  it("never substitutes the reader's currency for the ledger's", () => {
    const brazilian = formatMoney("pt-br", 4900, "USD")
    expect(brazilian).toContain("US$")
    expect(brazilian).not.toContain("R$ 49")
  })

  it("respects zero-decimal currencies in both locales", () => {
    expect(formatMoney("en", 4900, "JPY")).toBe("¥4,900")
    expect(norm(formatMoney("pt-br", 4900, "JPY"))).toBe("JP¥ 4.900")
  })
})

describe("formatBasisPoints", () => {
  it("renders whole and fractional percentages", () => {
    expect(formatBasisPoints("en", 3000)).toBe("30%")
    expect(formatBasisPoints("en", 2550)).toBe("25.5%")
  })

  it("uses the comma decimal separator in pt-BR", () => {
    expect(norm(formatBasisPoints("pt-br", 2550))).toBe("25,5%")
  })
})

describe("formatRate", () => {
  it("guards division by zero", () => {
    expect(formatRate("en", 5, 0)).toBe("0%")
  })

  it("keeps one decimal below 10% and none above", () => {
    expect(formatRate("en", 1, 40)).toBe("2.5%")
    expect(formatRate("en", 1, 4)).toBe("25%")
  })
})

describe("formatNumber", () => {
  it("groups thousands per locale", () => {
    expect(formatNumber("en", 18430)).toBe("18,430")
    expect(norm(formatNumber("pt-br", 18430))).toBe("18.430")
  })
})

describe("createFormatters", () => {
  it("binds the locale once for every helper", () => {
    const f = createFormatters("pt-br")
    expect(f.locale).toBe("pt-br")
    expect(norm(f.money(123456, "BRL"))).toBe("R$ 1.234,56")
    expect(norm(f.number(18430))).toBe("18.430")
    expect(norm(f.basisPoints(3000))).toBe("30%")
  })
})
