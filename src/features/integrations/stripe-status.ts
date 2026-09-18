/**
 * What the Stripe panel says, derived from evidence rather than from a status
 * column. Pure, so every branch is tested (`__tests__/stripe-status.test.ts`).
 *
 * - notStarted          no integration row yet → step 1
 * - awaitingSecret      row exists, no signing secret → steps 2 and 3
 * - awaitingFirstEvent  secret saved, nothing received yet
 * - receiving           the latest event was received and did not fail
 * - lastEventFailed     the latest event was received but processing failed
 * - signatureRejected   a delivery arrived after the secret was saved, and its
 *                       signature did not verify — almost always the wrong secret
 * - error               the integration was flagged `error`
 */
export type StripeConnectionState =
  | "notStarted"
  | "awaitingSecret"
  | "awaitingFirstEvent"
  | "receiving"
  | "lastEventFailed"
  | "signatureRejected"
  | "error"

export interface StripeStatusInput {
  integration: {
    status: "connected" | "disconnected" | "error" | "pending"
    secretSaved: boolean
    secretSavedAt: Date | null
    lastRejectedAt: Date | null
  } | null
  lastEventAt: Date | null
  lastEventFailed: boolean
}

export function deriveStripeState({ integration, lastEventAt, lastEventFailed }: StripeStatusInput): StripeConnectionState {
  if (!integration) return "notStarted"
  if (integration.status === "error") return "error"

  if (!integration.secretSaved) {
    // A legacy platform-webhook integration (Connect, or the demo seed) has no
    // per-workspace secret but can still prove itself with real events.
    if (integration.status === "connected" && lastEventAt) {
      return lastEventFailed ? "lastEventFailed" : "receiving"
    }
    return "awaitingSecret"
  }

  const { lastRejectedAt, secretSavedAt } = integration
  const rejectedSinceSecret = Boolean(
    lastRejectedAt &&
      (!secretSavedAt || lastRejectedAt > secretSavedAt) &&
      (!lastEventAt || lastRejectedAt > lastEventAt),
  )
  if (rejectedSinceSecret) return "signatureRejected"

  if (!lastEventAt) return "awaitingFirstEvent"
  return lastEventFailed ? "lastEventFailed" : "receiving"
}

/** Which badge a state shows. Green (`connected`) only with events behind it. */
export function stripeBadgeStatus(state: StripeConnectionState): "connected" | "pending" | "failed" | null {
  switch (state) {
    case "notStarted":
      return null
    case "awaitingSecret":
    case "awaitingFirstEvent":
      return "pending"
    case "receiving":
      return "connected"
    case "lastEventFailed":
    case "signatureRejected":
    case "error":
      return "failed"
  }
}

/**
 * Why events arrive but earn nothing, from one Stripe mode's recent evidence.
 * Dropped payments come first: they are lost for good, and fixing them (a
 * Stripe setting) differs from fixing unattributed ones (the identify call).
 */
export type AttributionIssue = "paymentsWithoutCustomer" | "noCommissions"

export function attributionIssue(evidence: {
  payments: number
  paymentsWithCommission: number
  paymentsWithoutCustomer: number
}): AttributionIssue | null {
  if (evidence.paymentsWithoutCustomer > 0) return "paymentsWithoutCustomer"
  if (evidence.payments > 0 && evidence.paymentsWithCommission === 0) return "noCommissions"
  return null
}

/**
 * Whether the setup wizard (rather than the connected summary) is shown. The
 * wizard stays until an event proves the endpoint works: its last step waits
 * for that first event.
 */
export function needsSetup(state: StripeConnectionState): boolean {
  return state === "notStarted" || state === "awaitingSecret" || state === "awaitingFirstEvent"
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["week", 7 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
]

/**
 * "há 5 minutos" / "5 minutes ago". Computed on the server and passed down as a
 * string, so the client never renders a different "now" than the server did.
 */
export function formatRelativeTime(locale: string, value: Date, now: Date = new Date()): string {
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
  const seconds = Math.round((value.getTime() - now.getTime()) / 1000)
  const magnitude = Math.abs(seconds)

  for (const [unit, size] of UNITS) {
    if (magnitude >= size) return formatter.format(Math.trunc(seconds / size), unit)
  }
  return formatter.format(0, "second")
}
