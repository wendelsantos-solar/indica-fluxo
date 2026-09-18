/**
 * The port every non-Stripe billing connector implements
 * (UNIVERSAL_ATTRIBUTION_ARCHITECTURE.md §5).
 *
 * A connector turns a provider's delivery into provider-free facts and, where
 * the provider allows, sets itself up. It holds no state and does no ledger
 * arithmetic: "how much commission to reverse" is the core's job, a connector
 * only says what happened (brief §49).
 *
 * Stripe predates this port and keeps `BillingProvider` (`types.ts`) and its own
 * routes; the catalog describes it like the others.
 */

import type { ConnectorId } from "./catalog"
import type { BillingEnvironment, NormalizedBillingEvent, VerifiedWebhook } from "./types"

/** What a webhook route hands a connector: the raw body and nothing parsed. */
export interface WebhookDelivery {
  rawBody: string
  /** Lower-cased header lookup. */
  header(name: string): string | null
  /** The request's query string (Mercado Pago `data.id`, AbacatePay `webhookSecret`). */
  query: URLSearchParams
}

/** `fetch`, injectable so contract tests never reach a provider. */
export type HttpClient = (input: string, init?: RequestInit) => Promise<Response>

export interface NormalizeContext {
  /** The decrypted credentials of the connection the delivery arrived on. */
  credentials: unknown
  /** The connection's own environment, when it has one (API-key connectors). */
  environment: BillingEnvironment | null
  http: HttpClient
}

export interface ConnectInput {
  /** What the founder pasted, already trimmed. Never logged. */
  apiKey: string
  /** Mercado Pago: the signature secret from its panel. */
  webhookSecret?: string
  /** This connection's webhook URL, without any secret. */
  webhookUrl: string
  /** A secret we generated for this connection (Asaas `authToken`, AbacatePay `secret`). */
  generatedSecret: string
  /** Optional contact for provider notices about the webhook (Asaas `email`). */
  notifyEmail?: string | null
}

export interface ConnectResult {
  /** Credentials to encrypt and store. Never returned to a browser. */
  credentials: Record<string, string>
  environment: BillingEnvironment
  /** When the provider tells us (Mercado Pago `user_id` arrives later, on events). */
  providerAccountId: string | null
  /** The webhook was created in the provider by the product. */
  webhookRegistered: boolean
}

export interface BillingConnector {
  readonly provider: Exclude<ConnectorId, "stripe">

  /**
   * Authenticates a delivery against the connection's credentials BEFORE
   * anything is parsed as trusted. Throws `WebhookAuthError` on any failure.
   * `providerEventId` in the result is the provider's own id; the ingest path
   * scopes it to the connection.
   */
  verify(delivery: WebhookDelivery, credentials: unknown): Promise<VerifiedWebhook>

  /**
   * Provider payload → zero or more facts. Async because some providers only
   * send an id (Mercado Pago); plural because one payment state can mean
   * "paid" and "partly refunded" at once. Idempotent downstream: the ledger
   * dedups on the provider's ids.
   */
  normalize(verified: VerifiedWebhook, context: NormalizeContext): Promise<NormalizedBillingEvent[]>

  /** Validates the credential and, when the provider allows, registers the webhook. */
  connect(input: ConnectInput, http: HttpClient): Promise<ConnectResult>

  /** Best effort: removes what `connect` created in the provider. Never throws. */
  disconnect?(credentials: unknown, http: HttpClient): Promise<boolean>
}

/** The delivery did not authenticate. Its reason is never echoed to the caller. */
export class WebhookAuthError extends Error {
  constructor(readonly code: "missing" | "mismatch" | "malformed") {
    super(`webhook authentication failed: ${code}`)
    this.name = "WebhookAuthError"
  }
}

/**
 * The provider refused the credential, or the product could not finish setting
 * the connection up. `code` is closed and safe to show; `status` is the
 * provider's HTTP status when there was one. No provider message is kept.
 */
export class ConnectorSetupError extends Error {
  constructor(
    readonly code: "invalid_credentials" | "webhook_registration_failed" | "provider_unavailable" | "wrong_environment",
    readonly status: number | null = null,
  ) {
    super(`connector setup failed: ${code}`)
    this.name = "ConnectorSetupError"
  }
}

/**
 * A provider API call inside `normalize` failed (Mercado Pago down, token
 * revoked). The event is marked failed and the provider retries it.
 */
export class ConnectorFetchError extends Error {
  constructor(readonly status: number | null) {
    super(`provider fetch failed${status ? ` (${status})` : ""}`)
    this.name = "ConnectorFetchError"
  }
}

/** Reads a JSON body without trusting it: `null` for anything unparseable. */
export function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
