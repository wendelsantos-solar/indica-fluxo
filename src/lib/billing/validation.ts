/**
 * Production validation of the billing connectors — the evidence ledger that
 * decides maturity (PROVIDER_PRODUCTION_VALIDATION.md is its human-readable
 * mirror). Pure data; no secret, key, token, e-mail or other PII ever goes here:
 * evidence is an opaque reference (a provider event id, a connection id, a
 * screenshot file name), never a credential.
 *
 * Contract tests, fixtures and DB tests stay mandatory, but they are NOT
 * evidence: every row below needs a round trip against a real account or the
 * provider's official sandbox (brief §16). `maturityGate` is what the test suite
 * checks before any connector may be `stable` (`__tests__/validation.test.ts`).
 */

import { CONNECTORS, type ConnectorId } from "./catalog"

/** Everything a payment method must prove, in the order it is usually run. */
export const VALIDATION_ITEMS = [
  "realConnection",
  "authentication",
  "webhookSetup",
  "webhookVerification",
  "firstPayment",
  "customerIdentity",
  "billingIdentity",
  "attribution",
  "commission",
  "renewal",
  "fullRefund",
  "partialRefund",
  "dispute",
  "duplicateWebhook",
  "invalidSignature",
  "testLiveIsolation",
  "disconnect",
  "reconnect",
  "multiAccount",
  "diagnostics",
  "noSecretInLogs",
] as const
export type ValidationItem = (typeof VALIDATION_ITEMS)[number]

/**
 * - `PASS`: done against a real account/sandbox, with evidence.
 * - `FAIL`: tried, did not behave; blocks stable until fixed and re-run.
 * - `N/A`: the provider does not offer it — needs a justification, never a shortcut.
 * - `PENDING`: not run yet.
 */
export type ValidationResult = "PASS" | "FAIL" | "N/A" | "PENDING"

export interface ValidationEntry {
  result: ValidationResult
  /** ISO date the check was run (PASS/FAIL). */
  date?: string
  environment?: "sandbox" | "test" | "live"
  /** Opaque reference: provider event id, connection id, screenshot name. Never a credential. */
  evidence?: string
  /** Required for N/A: why the provider has no such capability. */
  notes?: string
}

/**
 * Internal maturity (brief §14). The UI keeps showing only Stable / Beta /
 * Em breve; this says how far a Beta really is.
 *
 * - `coming_soon`: not connectable.
 * - `beta_implemented`: built, contract/fixture/DB-tested, no real round trip.
 * - `beta_real_tested`: some real round trips passed, the ledger is not complete.
 * - `stable`: every applicable item PASS (or justified N/A).
 */
export type ConnectorMaturity = "coming_soon" | "beta_implemented" | "beta_real_tested" | "stable"

type BetaConnector = Exclude<ConnectorId, "stripe">

const pending = (): Record<ValidationItem, ValidationEntry> =>
  Object.fromEntries(VALIDATION_ITEMS.map((item) => [item, { result: "PENDING" }])) as Record<ValidationItem, ValidationEntry>

/**
 * The ledger. Every beta connector starts all PENDING; an `N/A` states a
 * documented capability gap (BILLING_PROVIDER_MATRIX.md) and still needs the
 * real run to confirm the product never pretends otherwise.
 */
export const PROVIDER_VALIDATION: Record<BetaConnector, Record<ValidationItem, ValidationEntry>> = {
  mercado_pago: pending(),
  abacatepay: {
    ...pending(),
    partialRefund: { result: "N/A", notes: "AbacatePay offers full refunds only (official docs, pages/payment/refund)." },
  },
  asaas: pending(),
}

/**
 * Stripe was stable, publicly documented and in production use before this
 * ledger existed; its suites (adapter, routes, billing-events/ingest/plan-journey
 * DB tests) are its record. Its Connect OAuth round trip is tracked separately
 * as an open item in PROVIDER_PRODUCTION_VALIDATION.md.
 */
export const STABLE_BEFORE_LEDGER: readonly ConnectorId[] = ["stripe"]

export function connectorMaturity(id: ConnectorId): ConnectorMaturity {
  return CONNECTORS[id].maturity
}

/**
 * Whether a connector's ledger allows `stable`: every item PASS, or N/A with a
 * justification; every PASS carries a date, an environment and evidence.
 * Returns what still blocks it, so the report can say so.
 */
export function maturityGate(id: ConnectorId): { canBeStable: boolean; blocking: ValidationItem[] } {
  if (STABLE_BEFORE_LEDGER.includes(id)) return { canBeStable: true, blocking: [] }
  const ledger = PROVIDER_VALIDATION[id as BetaConnector]
  const blocking = VALIDATION_ITEMS.filter((item) => {
    const entry = ledger[item]
    if (entry.result === "N/A") return !entry.notes
    if (entry.result !== "PASS") return true
    return !entry.date || !entry.environment || !entry.evidence
  })
  return { canBeStable: blocking.length === 0, blocking }
}

/** What the ledger alone supports: never higher than the evidence. */
export function evidencedMaturity(id: ConnectorId): ConnectorMaturity {
  if (STABLE_BEFORE_LEDGER.includes(id)) return "stable"
  if (maturityGate(id).canBeStable) return "stable"
  const ledger = PROVIDER_VALIDATION[id as BetaConnector]
  return VALIDATION_ITEMS.some((item) => ledger[item].result === "PASS") ? "beta_real_tested" : "beta_implemented"
}
