/**
 * Why a billing event earned no commission — or did not enter the ledger at
 * all. A closed list, written to `webhook_events.reason_code` so diagnostics can
 * group by cause across providers (UNIVERSAL_ATTRIBUTION_ARCHITECTURE.md §8).
 *
 * Pure and client-safe: the diagnostics UI translates each code
 * (`dashboard.integrations.reasons.<code>` in both catalogues, pinned by a test).
 */

export const REASON_CODES = [
  /** A payment of a customer with no attribution. Normal: an organic customer. */
  "NO_ATTRIBUTION",
  "ATTRIBUTION_EXPIRED",
  /** The affiliate's participation is not approved (pending, rejected, suspended). */
  "AFFILIATE_INACTIVE",
  "RECURRENCE_WINDOW_CLOSED",
  "CURRENCY_MISMATCH",
  "ZERO_AMOUNT",
  /** The payment carried no provider customer, so it could not enter the ledger. */
  "CUSTOMER_NOT_LINKED",
  /** A test event on a live connection, or the reverse. Refused before processing. */
  "TEST_LIVE_MISMATCH",
  "DUPLICATE_EVENT",
  /** A valid event the connector does not turn into a ledger fact. */
  "UNSUPPORTED_EVENT",
  /** A live event for a workspace without live mode. */
  "LIVE_MODE_INACTIVE",
  /** No connection owns the account the event came from. */
  "NO_CONNECTION",
  "TOKEN_UNKNOWN",
  "TOKEN_EXPIRED",
  /** The reference was already bound to another customer; the first bind keeps it. */
  "TOKEN_CONFLICT",
  /** A refund or dispute whose payment is not in the ledger yet; the provider retries. */
  "PAYMENT_NOT_RECORDED_YET",
  /** A charge that did not go through. Recorded for diagnostics, never money. */
  "PAYMENT_FAILED",
  "PROCESSING_ERROR",
] as const

export type ReasonCode = (typeof REASON_CODES)[number]

export function isReasonCode(value: unknown): value is ReasonCode {
  return typeof value === "string" && (REASON_CODES as readonly string[]).includes(value)
}

/**
 * Reasons that are a normal outcome, not a fault: an organic customer, a
 * redelivery, an event type we do not need, a failed charge the customer may
 * retry. Diagnostics never raise an alert for these on their own.
 */
export const EXPECTED_REASONS: ReadonlySet<ReasonCode> = new Set([
  "NO_ATTRIBUTION",
  "DUPLICATE_EVENT",
  "UNSUPPORTED_EVENT",
  "RECURRENCE_WINDOW_CLOSED",
  "PAYMENT_FAILED",
  "TOKEN_UNKNOWN",
])

/** The commission engine's skip reasons, mapped onto the closed list. */
export function reasonForSkip(
  skip:
    | "participation_not_approved"
    | "attribution_expired"
    | "recurrence_window_closed"
    | "currency_mismatch"
    | "non_commissionable_transaction"
    | "zero_amount"
    | "no_original_commission",
): ReasonCode {
  switch (skip) {
    case "participation_not_approved":
      return "AFFILIATE_INACTIVE"
    case "attribution_expired":
      return "ATTRIBUTION_EXPIRED"
    case "recurrence_window_closed":
      return "RECURRENCE_WINDOW_CLOSED"
    case "currency_mismatch":
      return "CURRENCY_MISMATCH"
    case "zero_amount":
    case "non_commissionable_transaction":
    case "no_original_commission":
      return "ZERO_AMOUNT"
  }
}
