/**
 * Money is always an integer in minor units plus an ISO-4217 currency.
 * Never a float, never a Number holding "14.70". See DATABASE.md §4.
 */

export type Currency = string

const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "XOF", "XAF", "PYG"])

export function minorUnitExponent(currency: Currency): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2
}

/** Half-up rounding on integers. The single rounding rule in the product. */
export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value)
}

/** `applyBasisPoints(4900, 3000) === 1470` — 30% of $49.00. */
export function applyBasisPoints(amountMinor: number, basisPoints: number): number {
  return roundHalfUp((amountMinor * basisPoints) / 10_000)
}

export function formatMoney(
  amountMinor: number,
  currency: Currency,
  options: { compact?: boolean; signDisplay?: "auto" | "always" | "never" } = {},
): string {
  const exponent = minorUnitExponent(currency)
  const value = amountMinor / 10 ** exponent

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    notation: options.compact ? "compact" : "standard",
    maximumFractionDigits: options.compact ? 1 : exponent,
    minimumFractionDigits: options.compact ? 0 : exponent,
    signDisplay: options.signDisplay ?? "auto",
  }).format(value)
}

/** `3000 → "30%"`, `2550 → "25.5%"` */
export function formatBasisPoints(basisPoints: number): string {
  const percent = basisPoints / 100
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2).replace(/0$/, "")}%`
}

export function formatNumber(value: number, options: { compact?: boolean } = {}): string {
  return new Intl.NumberFormat("en-US", {
    notation: options.compact ? "compact" : "standard",
    maximumFractionDigits: options.compact ? 1 : 0,
  }).format(value)
}

/** Ratio as a percentage string, guarding division by zero. */
export function formatRate(numerator: number, denominator: number): string {
  if (denominator <= 0) return "0%"
  const pct = (numerator / denominator) * 100
  return `${pct >= 10 || pct === 0 ? pct.toFixed(0) : pct.toFixed(1)}%`
}
