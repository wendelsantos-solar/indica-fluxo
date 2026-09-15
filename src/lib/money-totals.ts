import type { Currency, MoneyOptions } from "@/lib/money"

/**
 * An aggregate that may span currencies is a *list* of totals, one per
 * currency — never one number. Adding BRL to USD would invent an exchange rate
 * the ledger never applied, so these helpers only ever group, order and
 * format; nothing here converts or sums across currencies. See DATABASE.md §4.
 */
export interface MoneyTotal {
  currency: Currency
  amountMinor: number
}

/** The typographic separator between per-currency figures on one line. */
export const MONEY_TOTALS_SEPARATOR = " · "

/**
 * Normalises raw aggregate rows (Postgres returns `bigint` as a string, and
 * `char(3)` may be padded) and merges duplicate currencies. Amounts stay
 * integer minor units; `Number` is exact up to 2^53.
 */
export function toMoneyTotals(
  rows: readonly { currency: string; amountMinor: number | string | bigint | null }[],
): MoneyTotal[] {
  const byCurrency = new Map<string, number>()
  for (const row of rows) {
    const currency = row.currency.trim().toUpperCase()
    if (!currency) continue
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + Number(row.amountMinor ?? 0))
  }
  return [...byCurrency].map(([currency, amountMinor]) => ({ currency, amountMinor }))
}

/**
 * Primary currency first (when given), then the largest magnitude, then
 * alphabetically so the order is stable between renders.
 */
export function orderMoneyTotals(
  totals: readonly MoneyTotal[],
  primaryCurrency?: Currency,
): MoneyTotal[] {
  const primary = primaryCurrency?.toUpperCase()
  return toMoneyTotals(totals).sort((a, b) => {
    if (primary) {
      if (a.currency === primary && b.currency !== primary) return -1
      if (b.currency === primary && a.currency !== primary) return 1
    }
    const magnitude = Math.abs(b.amountMinor) - Math.abs(a.amountMinor)
    if (magnitude !== 0) return magnitude
    return a.currency.localeCompare(b.currency)
  })
}

/** The amount recorded in one currency, `0` when there is none. */
export function amountIn(totals: readonly MoneyTotal[], currency: Currency): number {
  const wanted = currency.toUpperCase()
  return totals.reduce(
    (sum, total) => (total.currency.toUpperCase() === wanted ? sum + total.amountMinor : sum),
    0,
  )
}

/**
 * The currency a view leads with. The workspace default when there is any
 * activity in it; otherwise the currency with the most activity, so a
 * workspace set to BRL that only ever sold in USD does not headline `R$ 0,00`.
 * `lists` are consulted in order — the first list with a non-zero amount wins.
 */
export function pickPrimaryCurrency(
  defaultCurrency: Currency,
  ...lists: readonly (readonly MoneyTotal[])[]
): Currency {
  const fallback = defaultCurrency.toUpperCase()
  if (lists.some((list) => amountIn(list, fallback) !== 0)) return fallback

  for (const list of lists) {
    const [largest] = orderMoneyTotals(list.filter((total) => total.amountMinor !== 0))
    if (largest) return largest.currency
  }
  return fallback
}

/** `a − b`, per currency. A currency present on only one side keeps its sign. */
export function subtractMoneyTotals(
  a: readonly MoneyTotal[],
  b: readonly MoneyTotal[],
): MoneyTotal[] {
  return toMoneyTotals([
    ...a,
    ...b.map((total) => ({ currency: total.currency, amountMinor: -total.amountMinor })),
  ])
}

export function hasNonZeroTotal(totals: readonly MoneyTotal[]): boolean {
  return totals.some((total) => total.amountMinor !== 0)
}

type MoneyFormatter = (amountMinor: number, currency: Currency, options?: MoneyOptions) => string

/**
 * Splits totals into the figure a view shows prominently and a compact line
 * for the rest: `{ primary: "R$ 1.234,56", others: "€ 120,00 · £ 80,00" }`.
 * `others` is `null` when every other currency nets to zero. The primary
 * figure is always present — `R$ 0,00` rather than an empty cell.
 */
export function formatMoneyTotals(
  money: MoneyFormatter,
  totals: readonly MoneyTotal[],
  primaryCurrency: Currency,
  options?: MoneyOptions,
): { primary: string; others: string | null } {
  const primary = primaryCurrency.toUpperCase()
  const others = orderMoneyTotals(totals, primary).filter(
    (total) => total.currency !== primary && total.amountMinor !== 0,
  )
  return {
    primary: money(amountIn(totals, primary), primary, options),
    others:
      others.length > 0
        ? others
            .map((total) => money(total.amountMinor, total.currency, options))
            .join(MONEY_TOTALS_SEPARATOR)
        : null,
  }
}

/**
 * Every non-zero total on one line, primary first — for sentences that name
 * an amount ("R$ 900,00 · US$ 40,00 ready to pay"). Falls back to the primary
 * currency's zero so a sentence never loses its amount.
 */
export function formatMoneyTotalsInline(
  money: MoneyFormatter,
  totals: readonly MoneyTotal[],
  primaryCurrency: Currency,
  options?: MoneyOptions,
): string {
  const { primary, others } = formatMoneyTotals(money, totals, primaryCurrency, options)
  const primaryIsZero = amountIn(totals, primaryCurrency) === 0
  if (others === null) return primary
  return primaryIsZero ? others : `${primary}${MONEY_TOTALS_SEPARATOR}${others}`
}
