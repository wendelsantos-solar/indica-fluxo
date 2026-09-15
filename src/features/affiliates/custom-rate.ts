import { minorUnitExponent } from "@/lib/money"

/**
 * Turning what a founder types into a custom rate, without ever passing
 * through a float. A percentage is stored in basis points, a fixed rate in the
 * program currency's minor units (DATABASE.md §1), so "25.5" becomes 2550 and
 * "150.00" in BRL becomes 15000 by string arithmetic, not `* 100`.
 *
 * Pure and shared by the server action (parsing) and the dialog (prefilling).
 */

export type CustomRateType = "percentage" | "fixed"

export type ParsedCustomRate =
  | { ok: true; type: CustomRateType; value: number }
  | { ok: false; error: CustomRateError }

/** Catalogue keys under `errors.fields`. */
export type CustomRateError =
  | "customRateNumber"
  | "customRateRange"
  | "customRatePositive"
  | "customFixedAmount"

/** `program_affiliates.custom_commission_value` is a Postgres `integer`. */
const INT4_MAX = 2_147_483_647

/**
 * `"12"`, `"12.5"` or `"12,50"` → integer in units of 10^-exponent.
 * Returns null for anything else, including more fractional digits than the
 * exponent allows — silently rounding money someone typed is not our call.
 */
export function decimalToScaledInteger(input: string, exponent: number): number | null {
  const match = /^(\d+)(?:[.,](\d*))?$/.exec(input.trim())
  if (!match) return null

  const whole = match[1]!
  const fraction = match[2] ?? ""
  if (fraction.length > exponent) return null

  const digits = `${whole}${fraction.padEnd(exponent, "0")}`.replace(/^0+(?=\d)/, "")
  const value = Number(digits)
  return Number.isSafeInteger(value) ? value : null
}

/** The inverse, for prefilling a form: `(2550, 2) → "25.5"`, `(15000, 2) → "150"`. */
export function scaledIntegerToDecimal(value: number, exponent: number): string {
  const negative = value < 0
  const digits = String(Math.abs(Math.trunc(value))).padStart(exponent + 1, "0")
  const whole = exponent === 0 ? digits : digits.slice(0, -exponent)
  const fraction = exponent === 0 ? "" : digits.slice(-exponent).replace(/0+$/, "")
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`
}

export function parseCustomRate(input: {
  type: CustomRateType
  value: string
  currency: string
}): ParsedCustomRate {
  if (input.type === "percentage") {
    const basisPoints = decimalToScaledInteger(input.value, 2)
    if (basisPoints === null) return { ok: false, error: "customRateNumber" }
    if (basisPoints === 0) return { ok: false, error: "customRatePositive" }
    if (basisPoints > 10_000) return { ok: false, error: "customRateRange" }
    return { ok: true, type: "percentage", value: basisPoints }
  }

  const minor = decimalToScaledInteger(input.value, minorUnitExponent(input.currency))
  if (minor === null || minor === 0 || minor > INT4_MAX) {
    return { ok: false, error: "customFixedAmount" }
  }
  return { ok: true, type: "fixed", value: minor }
}

/** What the dialog shows for a stored rate. */
export function customRateToInput(type: CustomRateType, value: number, currency: string): string {
  return scaledIntegerToDecimal(value, type === "percentage" ? 2 : minorUnitExponent(currency))
}
