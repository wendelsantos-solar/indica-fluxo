import { toMoneyTotals, type MoneyTotal } from "@/lib/money-totals"

/**
 * What the portal's "A receber" is made of. Pure, so the split an affiliate
 * reads to answer "when do I get paid?" is unit-tested.
 *
 * The three parts follow the ledger's effective commission status
 * (`effectiveCommissionStatusSql`): `pending` still inside its hold period,
 * `available` once the hold is over, `approved` once the owner has put it in a
 * payout batch. Their sum is everything earned and not yet paid.
 */
export interface BalanceSource {
  currency: string
  holdMinor: number
  availableMinor: number
  approvedMinor: number
  nextReleaseAt: Date | null
}

export interface Receivable {
  total: MoneyTotal[]
  available: MoneyTotal[]
  hold: MoneyTotal[]
  approved: MoneyTotal[]
  /** When the next commission on hold becomes available; null when none is on hold. */
  nextReleaseAt: Date | null
}

/**
 * The earliest future release. Dates already reached are ignored: such a
 * commission is available, whatever its stored status says.
 */
export function nextReleaseDate(dates: readonly (Date | null)[], now: Date): Date | null {
  let earliest: Date | null = null
  for (const date of dates) {
    if (!date || date.getTime() <= now.getTime()) continue
    if (!earliest || date.getTime() < earliest.getTime()) earliest = date
  }
  return earliest
}

export function receivable(sources: readonly BalanceSource[], now: Date): Receivable {
  const pick = (value: (source: BalanceSource) => number) =>
    toMoneyTotals(sources.map((source) => ({ currency: source.currency, amountMinor: value(source) })))

  return {
    total: pick((source) => source.holdMinor + source.availableMinor + source.approvedMinor),
    available: pick((source) => source.availableMinor),
    hold: pick((source) => source.holdMinor),
    approved: pick((source) => source.approvedMinor),
    nextReleaseAt: nextReleaseDate(
      sources.filter((source) => source.holdMinor > 0).map((source) => source.nextReleaseAt),
      now,
    ),
  }
}
