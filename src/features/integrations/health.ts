/**
 * Connection health, derived from evidence — never from a status column alone
 * (UNIVERSAL_ATTRIBUTION_ARCHITECTURE.md §9). Pure, so every branch is tested
 * (`__tests__/health.test.ts`), and client-safe: the cards and the detail view
 * render straight from it.
 *
 * "Connected" means configured. Healthy means events arrive, turn into ledger
 * facts, find their customers, and attributed customers earn commissions.
 * An organic payment (a customer nobody referred) is never a problem.
 */

export type StageStatus = "healthy" | "warning" | "error" | "unknown"

export const HEALTH_STAGES = [
  "auth",
  "webhook",
  "eventNormalization",
  "customerMatching",
  "attribution",
  "commission",
] as const
export type HealthStage = (typeof HEALTH_STAGES)[number]

export type OverallHealth = "notConnected" | "connecting" | "healthy" | "degraded" | "actionRequired" | "error"

/** What the founder should do, most important first. One sentence each in the catalogues. */
export type HealthIssue =
  | "authFailed"
  | "signatureRejected"
  | "webhookSetupPending"
  | "awaitingFirstEvent"
  | "quiet"
  | "processingFailed"
  | "environmentMismatch"
  | "paymentsWithoutCustomer"
  | "expectedAttributionMissing"

export interface ConnectionEvidence {
  status: "connected" | "disconnected" | "error" | "pending"
  statusReason: string | null
  credentialsSaved: boolean
  /** When the credential was last confirmed (connect, secret saved). */
  configuredAt: Date | null
  lastRejectedAt: Date | null
  lastEventAt: Date | null
  lastEventFailed: boolean
  /** Counts over the evidence window. */
  events: number
  failed: number
  unsupported: number
  withoutCustomer: number
  mismatched: number
  payments: number
  paymentsWithCommission: number
  /** Payments of customers with a live attribution that still earned nothing. */
  expectedWithoutCommission: number
}

export interface ConnectionHealth {
  overall: OverallHealth
  stages: Record<HealthStage, StageStatus>
  issues: HealthIssue[]
}

/** No event for this long, after at least one, reads as "quiet" — a warning, not an error. */
export const QUIET_AFTER_DAYS = 7

const DAY = 24 * 60 * 60 * 1000

export function deriveConnectionHealth(evidence: ConnectionEvidence, now: Date = new Date()): ConnectionHealth {
  const stages: Record<HealthStage, StageStatus> = {
    auth: "unknown",
    webhook: "unknown",
    eventNormalization: "unknown",
    customerMatching: "unknown",
    attribution: "unknown",
    commission: "unknown",
  }
  const issues: HealthIssue[] = []

  if (evidence.status === "disconnected" && !evidence.credentialsSaved) {
    return { overall: "notConnected", stages, issues }
  }

  // AUTH
  if (evidence.status === "error" && evidence.statusReason === "invalid_credentials") {
    stages.auth = "error"
    issues.push("authFailed")
  } else if (evidence.credentialsSaved || evidence.status === "connected") {
    stages.auth = "healthy"
  }

  // WEBHOOK
  const rejectedSinceSetup = Boolean(
    evidence.lastRejectedAt &&
      (!evidence.configuredAt || evidence.lastRejectedAt > evidence.configuredAt) &&
      (!evidence.lastEventAt || evidence.lastRejectedAt > evidence.lastEventAt),
  )
  if (evidence.status === "error" && evidence.statusReason === "webhook_registration_failed") {
    stages.webhook = "error"
    issues.push("webhookSetupPending")
  } else if (rejectedSinceSetup) {
    stages.webhook = "error"
    issues.push("signatureRejected")
  } else if (evidence.lastEventAt) {
    const quiet = now.getTime() - evidence.lastEventAt.getTime() > QUIET_AFTER_DAYS * DAY
    stages.webhook = evidence.lastEventFailed ? "error" : quiet ? "warning" : "healthy"
    if (quiet && !evidence.lastEventFailed) issues.push("quiet")
  } else if (stages.auth === "healthy") {
    stages.webhook = "warning"
    issues.push("awaitingFirstEvent")
  }

  // EVENT NORMALIZATION
  if (evidence.events > 0) {
    if (evidence.failed > 0 && evidence.lastEventFailed) {
      stages.eventNormalization = "error"
      issues.push("processingFailed")
    } else if (evidence.mismatched > 0) {
      stages.eventNormalization = "warning"
      issues.push("environmentMismatch")
    } else {
      stages.eventNormalization = evidence.failed > 0 || evidence.unsupported > evidence.events / 2 ? "warning" : "healthy"
    }
  }

  // CUSTOMER MATCHING
  if (evidence.withoutCustomer > 0) {
    stages.customerMatching = "error"
    issues.push("paymentsWithoutCustomer")
  } else if (evidence.payments > 0) {
    stages.customerMatching = "healthy"
  }

  // ATTRIBUTION + COMMISSION — organic payments are never an issue.
  if (evidence.expectedWithoutCommission > 0) {
    stages.attribution = "warning"
    issues.push("expectedAttributionMissing")
  } else if (evidence.payments > 0) {
    stages.attribution = "healthy"
  }
  if (evidence.paymentsWithCommission > 0) stages.commission = "healthy"

  const overall: OverallHealth =
    evidence.status === "pending" || issues.includes("awaitingFirstEvent")
      ? issues.some((issue) => issue === "authFailed" || issue === "signatureRejected" || issue === "webhookSetupPending")
        ? "actionRequired"
        : "connecting"
      : issues.includes("processingFailed")
        ? "error"
        : issues.some((issue) =>
              issue === "authFailed" ||
              issue === "signatureRejected" ||
              issue === "webhookSetupPending" ||
              issue === "paymentsWithoutCustomer",
            )
          ? "actionRequired"
          : issues.length > 0
            ? "degraded"
            : "healthy"

  return { overall, stages, issues }
}

/** Which badge tone an overall state shows. Green only with evidence behind it. */
export function healthTone(overall: OverallHealth): "success" | "warning" | "danger" | "neutral" {
  switch (overall) {
    case "healthy":
      return "success"
    case "connecting":
    case "degraded":
      return "warning"
    case "actionRequired":
    case "error":
      return "danger"
    case "notConnected":
      return "neutral"
  }
}

/** The workspace summary: "4 connected · 3 healthy · 1 needs attention". */
export function summarizeHealth(healths: readonly OverallHealth[]): {
  connected: number
  healthy: number
  attention: number
  connecting: number
} {
  const active = healths.filter((health) => health !== "notConnected")
  return {
    connected: active.length,
    healthy: active.filter((health) => health === "healthy").length,
    attention: active.filter((health) => health === "degraded" || health === "actionRequired" || health === "error").length,
    connecting: active.filter((health) => health === "connecting").length,
  }
}

/**
 * What a connection's badge says. The overall health has one "not working yet"
 * state; the founder needs two: *Configurando* when a step only they can do is
 * pending (Mercado Pago's panel step), *Aguardando eventos* when everything is
 * set and the account simply has not sent a payment yet — a state, not a
 * problem (brief §17), so it is never coloured as one.
 */
export type ConnectionDisplayState = OverallHealth | "awaitingEvents" | "setupIncomplete"

export function connectionDisplayState(
  health: ConnectionHealth,
  status: ConnectionEvidence["status"],
  presence: ConnectionPresence = "visible",
): ConnectionDisplayState {
  if (presence === "setupIncomplete") return "setupIncomplete"
  if (health.overall === "connecting" && status !== "pending" && health.issues.includes("awaitingFirstEvent")) {
    return "awaitingEvents"
  }
  return health.overall
}

export function displayTone(state: ConnectionDisplayState): "success" | "warning" | "danger" | "neutral" {
  if (state === "awaitingEvents") return "neutral"
  if (state === "setupIncomplete") return "warning"
  return healthTone(state)
}

/**
 * Whether a connection row belongs on the Integrations lists (brief §2–§8).
 *
 * - `hidden`: a real disconnect (always stamped `disconnectedAt`), or an API-key
 *   attempt whose key was never stored — refused first connects are deleted,
 *   and a row interrupted mid-validation holds nothing to resume.
 * - `setupIncomplete`: a setup the founder really started and has not finished —
 *   today the manual Stripe path (account id saved, no signing secret yet). It
 *   is `disconnected` in the database but was never connected, so it has no
 *   `disconnectedAt`. Derived, no extra status (no migration).
 * - `visible`: everything else, including Mercado Pago `pending` (token valid,
 *   panel step left), which already has its own state.
 */
export type ConnectionPresence = "visible" | "setupIncomplete" | "hidden"

export function connectionPresence(connection: {
  status: ConnectionEvidence["status"]
  disconnectedAt: Date | null
  credentialsSaved: boolean
  mode: string | null
}): ConnectionPresence {
  if (connection.mode === "api_key" && !connection.credentialsSaved) return "hidden"
  if (connection.status !== "disconnected") return "visible"
  if (connection.disconnectedAt === null && !connection.credentialsSaved && connection.mode !== "oauth") return "setupIncomplete"
  return "hidden"
}

/**
 * The summary's "Status geral", from real evidence (brief §11): green only when
 * the tracker, customer identity and every connected account work. A count of
 * connections is never a synonym for health.
 */
export type WorkspaceStatus =
  | { key: "allGood"; tone: "success" }
  | { key: "attention"; count: number; tone: "warning" | "danger" }
  | { key: "incomplete"; tone: "neutral" }
  | { key: "awaitingEvents"; tone: "neutral" }

export function workspaceStatus(input: {
  trackerDetected: boolean
  identityDetected: boolean
  states: readonly ConnectionDisplayState[]
}): WorkspaceStatus {
  const active = input.states.filter((state) => state !== "notConnected")
  const broken = active.filter((state) => state === "actionRequired" || state === "error").length
  const degraded = active.filter((state) => state === "degraded").length
  if (broken + degraded > 0) return { key: "attention", count: broken + degraded, tone: broken > 0 ? "danger" : "warning" }
  if (
    !input.trackerDetected ||
    !input.identityDetected ||
    active.length === 0 ||
    active.includes("connecting") ||
    active.includes("setupIncomplete")
  ) {
    return { key: "incomplete", tone: "neutral" }
  }
  if (active.includes("awaitingEvents")) return { key: "awaitingEvents", tone: "neutral" }
  return { key: "allGood", tone: "success" }
}
