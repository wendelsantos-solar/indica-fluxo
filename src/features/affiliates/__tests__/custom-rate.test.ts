import { describe, expect, it } from "vitest"

import {
  customRateToInput,
  decimalToScaledInteger,
  parseCustomRate,
  scaledIntegerToDecimal,
} from "../custom-rate"

describe("decimalToScaledInteger", () => {
  it("scales without floating point error", () => {
    expect(decimalToScaledInteger("25.5", 2)).toBe(2550)
    expect(decimalToScaledInteger("0.29", 2)).toBe(29) // 0.29 * 100 = 28.999… as a float
    expect(decimalToScaledInteger("150", 2)).toBe(15000)
    expect(decimalToScaledInteger("12,50", 2)).toBe(1250)
    expect(decimalToScaledInteger(" 7 ", 0)).toBe(7)
  })

  it("rejects what it cannot read exactly", () => {
    expect(decimalToScaledInteger("", 2)).toBeNull()
    expect(decimalToScaledInteger("abc", 2)).toBeNull()
    expect(decimalToScaledInteger("-5", 2)).toBeNull()
    expect(decimalToScaledInteger("1.234,56", 2)).toBeNull()
    expect(decimalToScaledInteger("1.005", 2)).toBeNull()
    expect(decimalToScaledInteger("10.5", 0)).toBeNull()
    expect(decimalToScaledInteger("1e3", 2)).toBeNull()
  })
})

describe("scaledIntegerToDecimal", () => {
  it("round-trips the stored value", () => {
    expect(scaledIntegerToDecimal(2550, 2)).toBe("25.5")
    expect(scaledIntegerToDecimal(15000, 2)).toBe("150")
    expect(scaledIntegerToDecimal(5, 2)).toBe("0.05")
    expect(scaledIntegerToDecimal(900, 0)).toBe("900")
  })
})

describe("parseCustomRate", () => {
  it("stores a percentage in basis points", () => {
    expect(parseCustomRate({ type: "percentage", value: "30", currency: "USD" })).toEqual({
      ok: true,
      type: "percentage",
      value: 3000,
    })
  })

  it("bounds a percentage to (0, 100]", () => {
    expect(parseCustomRate({ type: "percentage", value: "0", currency: "USD" })).toEqual({
      ok: false,
      error: "customRatePositive",
    })
    expect(parseCustomRate({ type: "percentage", value: "100.01", currency: "USD" })).toEqual({
      ok: false,
      error: "customRateRange",
    })
    expect(parseCustomRate({ type: "percentage", value: "12.345", currency: "USD" })).toEqual({
      ok: false,
      error: "customRateNumber",
    })
  })

  it("stores a fixed rate in the program currency's minor units", () => {
    expect(parseCustomRate({ type: "fixed", value: "49.90", currency: "BRL" })).toEqual({
      ok: true,
      type: "fixed",
      value: 4990,
    })
    expect(parseCustomRate({ type: "fixed", value: "500", currency: "JPY" })).toEqual({
      ok: true,
      type: "fixed",
      value: 500,
    })
    expect(parseCustomRate({ type: "fixed", value: "0", currency: "BRL" })).toEqual({
      ok: false,
      error: "customFixedAmount",
    })
    expect(parseCustomRate({ type: "fixed", value: "99999999", currency: "BRL" })).toEqual({
      ok: false,
      error: "customFixedAmount",
    })
  })

  it("prefills the dialog with what was stored", () => {
    expect(customRateToInput("percentage", 2550, "USD")).toBe("25.5")
    expect(customRateToInput("fixed", 4990, "BRL")).toBe("49.9")
  })
})
