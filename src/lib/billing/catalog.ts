/**
 * What each billing connector is, can do and asks of the founder — as data.
 *
 * Pure and client-safe: the Integrations UI renders provider cards, effort
 * labels and the capability table from this, and the server enforces the same
 * `availability`. Facts come from `BILLING_PROVIDER_MATRIX.md` (official docs,
 * 2026-09-18); a capability the provider lacks is `false` and shown as "—",
 * never hidden (UNIVERSAL_ATTRIBUTION_ARCHITECTURE.md §5).
 */

import type { BillingProviderId } from "./types"
import type { ConnectorMaturity } from "./validation"

/** The providers a founder can connect. `paddle` and `manual` are not connectors. */
export const CONNECTOR_IDS = ["stripe", "mercado_pago", "abacatepay", "asaas"] as const
export type ConnectorId = (typeof CONNECTOR_IDS)[number]

export function isConnectorId(value: unknown): value is ConnectorId {
  return typeof value === "string" && (CONNECTOR_IDS as readonly string[]).includes(value)
}

/**
 * - `public`: production-ready, documented publicly.
 * - `beta`: implemented and contract-tested, not yet round-tripped against a
 *   real account. Offered in the product with a "Beta" label; never on the
 *   public site or SEO pages.
 * - `coming_soon`: shown, not connectable.
 */
export type ConnectorAvailability = "public" | "beta" | "coming_soon"

/**
 * How the founder connects:
 * - `oauth_or_webhook_secret`: Stripe — Connect OAuth when the platform has it,
 *   otherwise account id + endpoint signing secret.
 * - `api_key`: paste a key; the product registers the webhook itself.
 * - `api_key_and_webhook_secret`: paste a key and a signing secret, and add the
 *   webhook in the provider's panel (no registration API).
 */
export type ConnectionMethod = "oauth_or_webhook_secret" | "api_key" | "api_key_and_webhook_secret"

export interface ConnectorCapabilities {
  oauth: boolean
  apiKey: boolean
  /** The product creates the webhook in the provider through its API. */
  automaticWebhook: boolean
  subscriptions: boolean
  refunds: boolean
  partialRefunds: boolean
  disputes: boolean
  /** A dispute closed in the merchant's favour gives the commission back. */
  disputeWon: boolean
  failedPayments: boolean
  /** Several accounts of this provider in one workspace. */
  multiAccount: boolean
  /** A sandbox/test mode whose events reach the product. */
  testMode: boolean
  /** Where the attribution reference travels (the provider's own field). */
  referenceField: string
  /** The SaaS's customer id can travel in server-set metadata. */
  customerInMetadata: boolean
}

export interface ConnectorDescriptor {
  id: ConnectorId
  /** Brand name, as the provider writes it. Not translated. */
  name: string
  defaultAvailability: ConnectorAvailability
  /**
   * How far it really is (brief §14). Only the evidence ledger in
   * `validation.ts` may justify `stable` — `__tests__/validation.test.ts`
   * fails otherwise, and `public` availability requires `stable`.
   */
  maturity: ConnectorMaturity
  connectionMethod: ConnectionMethod
  capabilities: ConnectorCapabilities
  /** Currencies the provider reports. `null` = any ISO-4217 the payload names. */
  currencies: readonly string[] | null
}

export const CONNECTORS: Record<ConnectorId, ConnectorDescriptor> = {
  stripe: {
    id: "stripe",
    name: "Stripe",
    defaultAvailability: "public",
    maturity: "stable",
    connectionMethod: "oauth_or_webhook_secret",
    currencies: null,
    capabilities: {
      oauth: true,
      apiKey: false,
      automaticWebhook: true,
      subscriptions: true,
      refunds: true,
      partialRefunds: true,
      disputes: true,
      disputeWon: true,
      failedPayments: false,
      multiAccount: true,
      testMode: true,
      referenceField: "client_reference_id · metadata",
      customerInMetadata: true,
    },
  },
  mercado_pago: {
    id: "mercado_pago",
    name: "Mercado Pago",
    defaultAvailability: "beta",
    maturity: "beta_implemented",
    connectionMethod: "api_key_and_webhook_secret",
    currencies: null,
    capabilities: {
      oauth: false,
      apiKey: true,
      automaticWebhook: false,
      subscriptions: true,
      refunds: true,
      partialRefunds: true,
      disputes: true,
      disputeWon: false,
      failedPayments: true,
      multiAccount: true,
      // Test-credential payments send no notifications (panel simulator only).
      testMode: false,
      referenceField: "external_reference",
      customerInMetadata: true,
    },
  },
  abacatepay: {
    id: "abacatepay",
    name: "AbacatePay",
    defaultAvailability: "beta",
    maturity: "beta_implemented",
    connectionMethod: "api_key",
    currencies: ["BRL"],
    capabilities: {
      oauth: false,
      apiKey: true,
      automaticWebhook: true,
      subscriptions: true,
      refunds: true,
      partialRefunds: false,
      disputes: true,
      disputeWon: false,
      failedPayments: true,
      multiAccount: true,
      testMode: true,
      referenceField: "externalId",
      customerInMetadata: false,
    },
  },
  asaas: {
    id: "asaas",
    name: "Asaas",
    defaultAvailability: "beta",
    maturity: "beta_implemented",
    connectionMethod: "api_key",
    currencies: ["BRL"],
    capabilities: {
      oauth: false,
      apiKey: true,
      automaticWebhook: true,
      subscriptions: true,
      refunds: true,
      partialRefunds: true,
      disputes: true,
      disputeWon: false,
      failedPayments: true,
      multiAccount: true,
      testMode: true,
      referenceField: "externalReference",
      customerInMetadata: false,
    },
  },
}

/** The capability rows the detail view lists, in order. */
export const CAPABILITY_KEYS = [
  "subscriptions",
  "refunds",
  "partialRefunds",
  "disputes",
  "disputeWon",
  "failedPayments",
  "automaticWebhook",
  "testMode",
] as const satisfies readonly (keyof ConnectorCapabilities)[]

/**
 * Resolves availability from the defaults and the server's
 * `BILLING_CONNECTORS_DISABLED` list. Stripe cannot be disabled this way: it is
 * the production provider and existing integrations depend on it.
 */
export function resolveAvailability(disabled: readonly string[]): Record<ConnectorId, ConnectorAvailability> {
  const result = {} as Record<ConnectorId, ConnectorAvailability>
  for (const id of CONNECTOR_IDS) {
    const base = CONNECTORS[id].defaultAvailability
    result[id] = id !== "stripe" && disabled.includes(id) ? "coming_soon" : base
  }
  return result
}

export function isConnectable(availability: ConnectorAvailability): boolean {
  return availability !== "coming_soon"
}

/** Narrows a stored provider to a connector, for rows the catalog knows. */
export function connectorOf(provider: BillingProviderId): ConnectorDescriptor | null {
  return isConnectorId(provider) ? CONNECTORS[provider] : null
}
