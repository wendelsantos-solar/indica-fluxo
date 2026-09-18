/**
 * Money is always an integer in minor units plus an ISO-4217 currency.
 * Never a float, never a Number holding "14.70". See DATABASE.md §4.
 *
 * Formatting is locale-aware but the *currency is not negotiable*: a commission
 * recorded in USD is shown in USD to a Brazilian reader, formatted the way
 * Brazilian readers expect (`US$ 1.234,56`). Substituting the reader's own
 * currency would invent an exchange rate the ledger never applied.
 */

export type Currency = string

const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "XOF", "XAF", "PYG"])

export function minorUnitExponent(currency: Currency): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2
}

/**
 * A typed major amount ("14.70", "1500") to integer minor units for its
 * currency: × 100 for cents, × 1 for zero-decimal currencies like JPY. Input
 * boundary only — the ledger never holds a major amount.
 */
export function majorToMinor(amount: number, currency: Currency): number {
  return Math.round(amount * 10 ** minorUnitExponent(currency))
}

/**
 * An exact decimal amount from a provider payload ("94.51", 94.51, "1500") to
 * integer minor units, without float multiplication: the digits are shifted as
 * text. Mercado Pago and Asaas send decimals; `94.51 * 100` is 9450.999… in
 * binary floating point, which is exactly the bug this avoids.
 *
 * Returns `null` for anything that is not a plain, finite, non-negative decimal
 * with no more fractional digits than the currency has.
 */
export function decimalToMinor(value: unknown, currency: Currency): number | null {
  const text = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : typeof value === "string" ? value.trim() : ""
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text)
  if (!match) return null
  const exponent = minorUnitExponent(currency)
  const fraction = (match[2] ?? "").replace(/0+$/, "")
  if (fraction.length > exponent) return null
  const minor = Number(`${match[1]}${fraction.padEnd(exponent, "0")}`)
  return Number.isSafeInteger(minor) ? minor : null
}

/** The inverse, for pre-filling a form field with a stored amount. */
export function minorToMajor(amountMinor: number, currency: Currency): number {
  return amountMinor / 10 ** minorUnitExponent(currency)
}

/** Half-up rounding on integers. The single rounding rule in the product. */
export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value)
}

/** `applyBasisPoints(4900, 3000) === 1470` — 30% of $49.00. */
export function applyBasisPoints(amountMinor: number, basisPoints: number): number {
  return roundHalfUp((amountMinor * basisPoints) / 10_000)
}

export interface MoneyOptions {
  compact?: boolean
  signDisplay?: "auto" | "always" | "never"
}

export function formatMoney(
  locale: string,
  amountMinor: number,
  currency: Currency,
  options: MoneyOptions = {},
): string {
  const exponent = minorUnitExponent(currency)
  const value = amountMinor / 10 ** exponent

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    notation: options.compact ? "compact" : "standard",
    maximumFractionDigits: options.compact ? 1 : exponent,
    minimumFractionDigits: options.compact ? 0 : exponent,
    signDisplay: options.signDisplay ?? "auto",
  }).format(value)
}

/** `3000 → "30%"`, `2550 → "25,5%"` in pt-BR. */
export function formatBasisPoints(locale: string, basisPoints: number): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(basisPoints / 10_000)
}

export function formatNumber(
  locale: string,
  value: number,
  options: { compact?: boolean } = {},
): string {
  return new Intl.NumberFormat(locale, {
    notation: options.compact ? "compact" : "standard",
    maximumFractionDigits: options.compact ? 1 : 0,
  }).format(value)
}

/** Ratio as a percentage string, guarding division by zero. */
export function formatRate(locale: string, numerator: number, denominator: number): string {
  if (denominator <= 0) {
    return new Intl.NumberFormat(locale, { style: "percent" }).format(0)
  }

  const ratio = numerator / denominator
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: ratio >= 0.1 || ratio === 0 ? 0 : 1,
  }).format(ratio)
}

/**
 * `2026-09-14` reads as 14 September to a Brazilian and as the 9th of
 * something to an American. Dates in this product are facts on a ledger, so
 * they are always rendered in the reader's own convention rather than in ISO.
 */
export function formatDate(
  locale: string,
  value: Date,
  style: "short" | "medium" = "short",
  timeZone = "UTC",
): string {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: style === "short" ? "2-digit" : "short",
    year: "numeric",
    timeZone,
  }).format(value)
}

/**
 * Binds the locale once so a view does not thread it through every call.
 *
 * Server components get this from `getFormatters()` in `@/i18n/format`; client
 * components from `useFormatters()`. Both are thin wrappers around this.
 */
export function createFormatters(locale: string, timeZone = "UTC") {
  return {
    locale,
    timeZone,
    money: (amountMinor: number, currency: Currency, options?: MoneyOptions) =>
      formatMoney(locale, amountMinor, currency, options),
    basisPoints: (basisPoints: number) => formatBasisPoints(locale, basisPoints),
    number: (value: number, options?: { compact?: boolean }) =>
      formatNumber(locale, value, options),
    rate: (numerator: number, denominator: number) =>
      formatRate(locale, numerator, denominator),
    date: (value: Date, style?: "short" | "medium") => formatDate(locale, value, style, timeZone),
  }
}

export type Formatters = ReturnType<typeof createFormatters>
