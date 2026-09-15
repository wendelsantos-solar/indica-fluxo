/**
 * The name a reader sees for a payout batch.
 *
 * `payout_batches.reference` is stored in English ("September 2026", or
 * "September 2026 #2" for a second batch that month) and is unique per
 * workspace, so it is ledger data, not a label: rewriting it would touch
 * existing rows and their uniqueness (UI_UX_FUNCTIONAL_FINDINGS O1). The month
 * it names is the month of `period_end`, so the label is rebuilt from that date
 * in the reader's language and keeps only the stored ordinal suffix.
 *
 * Time zones: the batch month is chosen on the workspace's wall clock
 * (`localMonthPeriod` in `features/payouts/actions.ts`), but `period_start` and
 * `period_end` are stored as calendar dates at 00:00 UTC, and the reference is
 * built from them in UTC (`services/payouts.ts`). Reading them back in UTC is
 * therefore what keeps label, reference and period consistent; formatting them
 * in the workspace zone would show 31/07 for an August batch west of UTC.
 *
 * Pure and framework-free, so client and server render the same text.
 */

const ORDINAL_SUFFIX = /\s#(\d+)$/

export function batchOrdinal(reference: string): number | null {
  const match = ORDINAL_SUFFIX.exec(reference.trim())
  if (!match) return null
  const value = Number(match[1])
  return Number.isSafeInteger(value) && value > 1 ? value : null
}

/** `"setembro de 2026"` → `"Setembro de 2026"`: a month opening a title. */
function capitalise(locale: string, text: string): string {
  const first = text.charAt(0)
  return first ? first.toLocaleUpperCase(locale) + text.slice(1) : text
}

/**
 * `(pt-BR, 2026-09-30, "September 2026 #2")` → `"Setembro de 2026 #2"`;
 * `(en, …)` → `"September 2026 #2"`. An invalid date falls back to the stored
 * reference rather than rendering "Invalid Date".
 */
export function formatBatchLabel(locale: string, periodEnd: Date, reference: string): string {
  if (Number.isNaN(periodEnd.getTime())) return reference

  let month: string
  try {
    month = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(periodEnd)
  } catch {
    return reference
  }

  const ordinal = batchOrdinal(reference)
  const label = capitalise(locale, month)
  return ordinal ? `${label} #${ordinal}` : label
}
