import "server-only"

import { randomBytes } from "node:crypto"

import { and, asc, eq, sql } from "drizzle-orm"
import { z } from "zod"

import { CONNECTOR_IDS, isConnectable, isConnectorId, resolveAvailability, type ConnectorAvailability, type ConnectorId } from "@/lib/billing/catalog"
import { ConnectorSetupError, type HttpClient } from "@/lib/billing/connector"
import { billingConnector, isApiConnectorId, type ApiConnectorId } from "@/lib/billing/connectors"
import { hasWebhookSecret, withWebhookSecret } from "@/lib/billing/mercado-pago/connector"
import type { BillingEnvironment, BillingProviderId } from "@/lib/billing/types"
import { peppered } from "@/lib/crypto/hash"
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets"
import { logger } from "@/lib/logger"
import { appUrl } from "@/lib/site"
import { db, withUser } from "@/server/db"
import { billingSetupSelections, integrations } from "@/server/db/schema"
import { AppError, NotFoundError, ValidationError } from "@/server/policies/errors"
import { requireMembership } from "@/server/policies/workspace"

import { recordAudit } from "./audit"

/**
 * Billing connections — a workspace's merchant accounts at its payment
 * providers (UNIVERSAL_ATTRIBUTION_ARCHITECTURE.md §2, §5).
 *
 * The table is `integrations` (evolved, not renamed). N per workspace, N per
 * provider. Stripe's own setup (account id + endpoint secrets, or Connect
 * OAuth) stays in `integrations.ts` / `stripe-connect.ts`; this module owns
 * listing, availability, the API-key connectors, disconnecting and the
 * provider selection.
 *
 * Credentials are AES-256-GCM encrypted, parsed on the way out, never returned
 * to a browser, never logged, dropped on disconnect.
 */

/** Why a connection is `error`/`pending`. Closed, safe to show and translate. */
export const CONNECTION_STATUS_REASONS = [
  "invalid_credentials",
  "webhook_registration_failed",
  "provider_unavailable",
  "wrong_environment",
] as const
export type ConnectionStatusReason = (typeof CONNECTION_STATUS_REASONS)[number]

/** A setup failure the founder can act on. `errors.billing.<code>` in both catalogues. */
export class ConnectionSetupFailedError extends AppError {
  constructor(readonly reason: ConnectionStatusReason | "duplicate" | "unavailable") {
    super(`billing connection setup failed: ${reason}`, `billing_${reason}`, 422, `billing.${reason}`)
    this.name = "ConnectionSetupFailedError"
  }
}

/** Server env: `BILLING_CONNECTORS_DISABLED=mercado_pago,asaas` turns a beta connector off. */
export function connectorAvailability(): Record<ConnectorId, ConnectorAvailability> {
  const disabled = (process.env.BILLING_CONNECTORS_DISABLED ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
  return resolveAvailability(disabled)
}

/** Where a connection's provider delivers events. Never carries a secret. */
export function connectorWebhookPath(provider: ApiConnectorId, integrationId: string): string {
  return `/api/webhooks/billing/${provider}/${integrationId}`
}

export function connectorWebhookUrl(provider: ApiConnectorId, integrationId: string): string {
  return new URL(connectorWebhookPath(provider, integrationId), appUrl()).toString()
}

const metadataSchema = z
  .object({
    mode: z.string().optional().catch(undefined),
    webhookRegistered: z.boolean().optional().catch(undefined),
    webhookRemoved: z.boolean().optional().catch(undefined),
    secretSavedAt: z.iso.datetime().optional().catch(undefined),
    testSecretSavedAt: z.iso.datetime().optional().catch(undefined),
    liveSecretSavedAt: z.iso.datetime().optional().catch(undefined),
    lastRejectedAt: z.iso.datetime().optional().catch(undefined),
    connectStartedAt: z.iso.datetime().optional().catch(undefined),
  })
  .loose()

export interface BillingConnection {
  id: string
  provider: BillingProviderId
  displayName: string | null
  providerAccountId: string | null
  status: "connected" | "disconnected" | "error" | "pending"
  statusReason: ConnectionStatusReason | null
  /** `null` spans both modes (Stripe). */
  environment: BillingEnvironment | null
  /** How it was connected: `oauth`, `webhook_secret` (Stripe manual), `api_key`. */
  mode: string | null
  webhookRegistered: boolean
  /** Whether credentials are stored. The credentials themselves never leave the server. */
  credentialsSaved: boolean
  lastRejectedAt: Date | null
  lastVerifiedAt: Date | null
  connectStartedAt: Date | null
  connectedAt: Date | null
  disconnectedAt: Date | null
  createdAt: Date
}

function readReason(value: string | null): ConnectionStatusReason | null {
  return (CONNECTION_STATUS_REASONS as readonly string[]).includes(value ?? "") ? (value as ConnectionStatusReason) : null
}

/** Every connection of a workspace, oldest first. Any member; no credential leaves the database. */
export async function listBillingConnections(userId: string, workspaceId: string): Promise<BillingConnection[]> {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId)
    const rows = await tx
      .select({
        id: integrations.id,
        provider: integrations.provider,
        displayName: integrations.displayName,
        providerAccountId: integrations.providerAccountId,
        status: integrations.status,
        statusReason: integrations.statusReason,
        environment: integrations.environment,
        metadata: integrations.metadata,
        credentialsSaved: sql<boolean>`${integrations.encryptedCredentials} is not null`,
        lastVerifiedAt: integrations.lastVerifiedAt,
        connectedAt: integrations.connectedAt,
        disconnectedAt: integrations.disconnectedAt,
        createdAt: integrations.createdAt,
      })
      .from(integrations)
      .where(eq(integrations.workspaceId, workspaceId))
      .orderBy(asc(integrations.createdAt))

    return rows.map((row) => {
      const parsed = metadataSchema.safeParse(row.metadata)
      const meta = parsed.success ? parsed.data : {}
      return {
        id: row.id,
        provider: row.provider,
        displayName: row.displayName,
        providerAccountId: row.providerAccountId,
        status: row.status,
        statusReason: readReason(row.statusReason),
        environment: row.environment,
        mode: meta.mode ?? null,
        webhookRegistered: meta.webhookRegistered === true || meta.mode === "oauth",
        credentialsSaved: row.credentialsSaved,
        lastRejectedAt: meta.lastRejectedAt ? new Date(meta.lastRejectedAt) : null,
        lastVerifiedAt: row.lastVerifiedAt,
        connectStartedAt: meta.connectStartedAt ? new Date(meta.connectStartedAt) : null,
        connectedAt: row.connectedAt,
        disconnectedAt: row.disconnectedAt,
        createdAt: row.createdAt,
      }
    })
  })
}

export interface ConnectApiProviderInput {
  provider: ApiConnectorId
  apiKey: string
  webhookSecret?: string | null
  displayName?: string | null
  /** Reconnect / rotate: the existing connection to update instead of a new one. */
  integrationId?: string | null
  /** Where the provider may send notices about the webhook (Asaas), the acting admin's own address. */
  notifyEmail?: string | null
}

/** A peppered fingerprint of a credential: detects "the same key twice" without storing it. */
function credentialFingerprint(provider: ApiConnectorId, apiKey: string): string {
  return peppered(`${provider}:${apiKey}`).slice(0, 24)
}

/**
 * Connects (or reconnects) an API-key provider. Owners and admins only.
 *
 *   1. a `pending` row, so the webhook URL — which names the connection — exists
 *   2. the connector validates the key and, where the provider allows,
 *      registers the webhook with a secret generated here (no DB transaction
 *      is held open across the network call)
 *   3. `connected` with the credentials encrypted — or, on failure, a new row
 *      is removed (nothing references it) and an existing one keeps working
 *      credentials and records why the new ones were refused
 *
 * Never marks anything connected before the provider confirmed it.
 */
export async function connectApiProvider(
  userId: string,
  workspaceId: string,
  input: ConnectApiProviderInput,
  http: HttpClient = fetch,
): Promise<{ integrationId: string; webhookRegistered: boolean; environment: BillingEnvironment }> {
  const availability = connectorAvailability()[input.provider]
  if (!isConnectable(availability)) throw new ConnectionSetupFailedError("unavailable")

  const apiKey = input.apiKey.trim()
  if (apiKey.length < 10 || apiKey.length > 500) {
    throw new ValidationError("API key is required.", { apiKey: ["Required."] }, "billing.invalid_credentials")
  }
  const webhookSecret = input.webhookSecret?.trim() || undefined
  const displayName = input.displayName?.trim().slice(0, 60) || null
  const fingerprint = credentialFingerprint(input.provider, apiKey)
  const now = new Date()

  const { integrationId, isNew } = await withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

    const [duplicate] = await tx
      .select({ id: integrations.id })
      .from(integrations)
      .where(
        and(
          eq(integrations.workspaceId, workspaceId),
          eq(integrations.provider, input.provider),
          sql`${integrations.metadata}->>'credentialFingerprint' = ${fingerprint}`,
          sql`${integrations.status} <> 'disconnected'`,
        ),
      )
      .limit(1)
    if (duplicate && duplicate.id !== input.integrationId) throw new ConnectionSetupFailedError("duplicate")

    if (input.integrationId) {
      const [existing] = await tx
        .select({ id: integrations.id })
        .from(integrations)
        .where(
          and(
            eq(integrations.id, input.integrationId),
            eq(integrations.workspaceId, workspaceId),
            eq(integrations.provider, input.provider),
          ),
        )
        .limit(1)
      if (!existing) throw new NotFoundError("Connection not found.", "notFound")
      return { integrationId: existing.id, isNew: false }
    }

    const [row] = await tx
      .insert(integrations)
      .values({
        workspaceId,
        provider: input.provider,
        status: "pending",
        displayName,
        metadata: { mode: "api_key", connectStartedAt: now.toISOString() },
      })
      .returning({ id: integrations.id })
    return { integrationId: row!.id, isNew: true }
  })

  const generatedSecret = randomBytes(32).toString("base64url")
  let result
  try {
    result = await billingConnector(input.provider).connect(
      {
        apiKey,
        webhookSecret,
        webhookUrl: connectorWebhookUrl(input.provider, integrationId),
        generatedSecret,
        notifyEmail: input.notifyEmail ?? null,
      },
      http,
    )
  } catch (error) {
    const reason: ConnectionStatusReason =
      error instanceof ConnectorSetupError ? error.code : "provider_unavailable"
    logger.warn("billing connection refused by the provider", {
      workspaceId,
      provider: input.provider,
      integrationId,
      reason,
      status: error instanceof ConnectorSetupError ? error.status : null,
    })
    await withUser(userId, async (tx) => {
      if (isNew) {
        // Never connected, never delivered anything: nothing references it.
        await tx.delete(integrations).where(eq(integrations.id, integrationId))
      }
      await recordAudit(tx, {
        workspaceId,
        actorUserId: userId,
        entityType: "integration",
        entityId: isNew ? null : integrationId,
        action: reason === "webhook_registration_failed" ? "integration.webhook_failed" : "integration.credentials_updated",
        metadata: { provider: input.provider, outcome: "refused", reason },
      })
    })
    throw new ConnectionSetupFailedError(reason)
  }

  // Mercado Pago before its panel step: the token is valid, the webhook is not
  // configured yet. Pending — never shown as connected until it can verify.
  const awaitingWebhook = input.provider === "mercado_pago" && !hasWebhookSecret(result.credentials)

  await withUser(userId, async (tx) => {
    await tx
      .update(integrations)
      .set({
        status: awaitingWebhook ? "pending" : "connected",
        statusReason: null,
        environment: result.environment,
        encryptedCredentials: encryptSecret(JSON.stringify(result.credentials)),
        ...(result.providerAccountId ? { providerAccountId: result.providerAccountId } : {}),
        ...(displayName ? { displayName } : {}),
        lastVerifiedAt: now,
        connectedAt: awaitingWebhook ? null : now,
        disconnectedAt: null,
        metadata: sql`(${integrations.metadata} - 'lastRejectedAt') || ${JSON.stringify({
          mode: "api_key",
          webhookRegistered: result.webhookRegistered,
          credentialFingerprint: fingerprint,
        })}::jsonb`,
        updatedAt: now,
      })
      .where(eq(integrations.id, integrationId))

    const base = { workspaceId, actorUserId: userId, entityType: "integration", entityId: integrationId }
    await recordAudit(tx, {
      ...base,
      action: isNew ? "integration.connected" : "integration.reconnected",
      metadata: { provider: input.provider, integrationId, environment: result.environment, mode: "api_key" },
    })
    if (result.webhookRegistered) {
      await recordAudit(tx, {
        ...base,
        action: "integration.webhook_registered",
        metadata: { provider: input.provider, integrationId },
      })
    }
  })

  logger.info("billing connection connected", {
    workspaceId,
    provider: input.provider,
    integrationId,
    environment: result.environment,
  })
  return { integrationId, webhookRegistered: result.webhookRegistered, environment: result.environment }
}

/**
 * Mercado Pago step 2: the signature secret from the merchant's panel, saved
 * once they added this connection's URL there. Owners and admins only.
 */
export async function saveConnectionWebhookSecret(
  userId: string,
  workspaceId: string,
  integrationId: string,
  webhookSecret: string,
): Promise<void> {
  const now = new Date()
  await withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")
    const [row] = await tx
      .select({ provider: integrations.provider, encryptedCredentials: integrations.encryptedCredentials, status: integrations.status })
      .from(integrations)
      .where(and(eq(integrations.id, integrationId), eq(integrations.workspaceId, workspaceId)))
      .limit(1)
      .for("update")
    if (!row || row.provider !== "mercado_pago" || !row.encryptedCredentials) {
      throw new NotFoundError("Connection not found.", "notFound")
    }
    let credentials: Record<string, string>
    try {
      credentials = withWebhookSecret(JSON.parse(decryptSecret(row.encryptedCredentials)), webhookSecret)
    } catch {
      throw new ConnectionSetupFailedError("invalid_credentials")
    }
    const replaced = row.status === "connected"
    await tx
      .update(integrations)
      .set({
        encryptedCredentials: encryptSecret(JSON.stringify(credentials)),
        status: "connected",
        statusReason: null,
        connectedAt: now,
        lastVerifiedAt: now,
        metadata: sql`(${integrations.metadata} - 'lastRejectedAt') || ${JSON.stringify({ webhookSecretSavedAt: now.toISOString() })}::jsonb`,
        updatedAt: now,
      })
      .where(eq(integrations.id, integrationId))
    await recordAudit(tx, {
      workspaceId,
      actorUserId: userId,
      entityType: "integration",
      entityId: integrationId,
      action: replaced ? "integration.credentials_updated" : "integration.connected",
      metadata: { provider: "mercado_pago", integrationId, webhookSecret: "saved" },
    })
  })
}

/**
 * Disconnects one connection. Owners and admins only.
 *
 * New events stop being processed (the webhook route answers 404 without
 * credentials). Transactions, commissions and payouts are untouched — nothing
 * in the ledger references a connection by a cascading key (CLAUDE.md rule 9).
 * The provider-side webhook is removed when the connector can (Asaas).
 */
export async function disconnectBillingConnection(
  userId: string,
  workspaceId: string,
  integrationId: string,
  http: HttpClient = fetch,
): Promise<{ webhookRemoved: boolean }> {
  const target = await withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")
    const [row] = await tx
      .select({ id: integrations.id, provider: integrations.provider, encryptedCredentials: integrations.encryptedCredentials })
      .from(integrations)
      .where(and(eq(integrations.id, integrationId), eq(integrations.workspaceId, workspaceId)))
      .limit(1)
    if (!row) throw new NotFoundError("Connection not found.", "notFound")
    return row
  })

  let webhookRemoved = false
  const connector = isApiConnectorId(target.provider) ? billingConnector(target.provider) : null
  if (connector?.disconnect && target.encryptedCredentials) {
    try {
      webhookRemoved = await connector.disconnect(JSON.parse(decryptSecret(target.encryptedCredentials)), http)
    } catch {
      webhookRemoved = false
    }
  }

  await withUser(userId, async (tx) => {
    await tx
      .update(integrations)
      .set({
        status: "disconnected",
        statusReason: null,
        disconnectedAt: new Date(),
        // Credentials are dropped on disconnect; nothing to leak afterwards.
        encryptedCredentials: null,
        metadata: sql`(${integrations.metadata} - 'secretSavedAt' - 'testSecretSavedAt' - 'liveSecretSavedAt' - 'lastRejectedAt' - 'credentialFingerprint') || ${JSON.stringify({ webhookRegistered: false })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, integrationId))

    await recordAudit(tx, {
      workspaceId,
      actorUserId: userId,
      entityType: "integration",
      entityId: integrationId,
      action: "integration.disconnected",
      metadata: { provider: target.provider, integrationId, webhookRemoved },
    })
  })

  return { webhookRemoved }
}

/** Renames a connection ("Conta principal", "Stripe EUA"). Owners and admins only. */
export async function renameBillingConnection(
  userId: string,
  workspaceId: string,
  integrationId: string,
  displayName: string,
): Promise<void> {
  const name = displayName.trim().slice(0, 60)
  if (!name) throw new ValidationError("Name is required.", { displayName: ["Required."] })
  await withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")
    const [row] = await tx
      .update(integrations)
      .set({ displayName: name, updatedAt: new Date() })
      .where(and(eq(integrations.id, integrationId), eq(integrations.workspaceId, workspaceId)))
      .returning({ id: integrations.id, provider: integrations.provider })
    if (!row) throw new NotFoundError("Connection not found.", "notFound")
    await recordAudit(tx, {
      workspaceId,
      actorUserId: userId,
      entityType: "integration",
      entityId: row.id,
      action: "integration.renamed",
      metadata: { provider: row.provider, integrationId: row.id },
    })
  })
}

// ---------------------------------------------------------------------------
// The wizard's "How does your SaaS get paid?" — a multi-select, not a gate.
// ---------------------------------------------------------------------------

/** "Outro": a method with no connector. Stored beside the connector ids; never a connection. */
export const SELECTION_OTHER = "other"
const selectionSchema = z.array(z.enum([...CONNECTOR_IDS, SELECTION_OTHER])).max(8)

export interface BillingSelection {
  providers: ConnectorId[]
  /** The founder also charges through a method the product cannot connect. */
  other: boolean
}

export async function readBillingSelection(userId: string, workspaceId: string): Promise<BillingSelection | null> {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId)
    const [row] = await tx
      .select({ providers: billingSetupSelections.providers })
      .from(billingSetupSelections)
      .where(eq(billingSetupSelections.workspaceId, workspaceId))
      .limit(1)
    if (!row) return null
    const parsed = selectionSchema.safeParse(row.providers)
    const values = parsed.success ? parsed.data : []
    return { providers: values.filter(isConnectorId), other: values.includes(SELECTION_OTHER) }
  })
}

export async function getBillingSelection(userId: string, workspaceId: string): Promise<ConnectorId[] | null> {
  return (await readBillingSelection(userId, workspaceId))?.providers ?? null
}

export async function saveBillingSelection(
  userId: string,
  workspaceId: string,
  providers: string[],
): Promise<Array<ConnectorId | typeof SELECTION_OTHER>> {
  const parsed = selectionSchema.safeParse([...new Set(providers)])
  if (!parsed.success) throw new ValidationError("Unknown provider.", { providers: ["Invalid."] })
  const now = new Date()
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")
    await tx
      .insert(billingSetupSelections)
      .values({ workspaceId, providers: parsed.data, updatedBy: userId, updatedAt: now })
      .onConflictDoUpdate({
        target: billingSetupSelections.workspaceId,
        set: { providers: parsed.data, updatedBy: userId, updatedAt: now },
      })
    await recordAudit(tx, {
      workspaceId,
      actorUserId: userId,
      entityType: "workspace",
      entityId: workspaceId,
      action: "integration.providers_selected",
      metadata: { providers: parsed.data },
    })
    return parsed.data
  })
}

// ---------------------------------------------------------------------------
// INGEST PATH ONLY — service connection, RLS bypassed.
//
// Called by `POST /api/webhooks/billing/[provider]/[integrationId]`, whose
// caller is the provider, not a user: there is no session to impersonate, and
// the decrypted credentials are what authenticate the delivery
// (ARCHITECTURE.md §2). Returned to the route for verification only; never logged.
// ---------------------------------------------------------------------------

export interface ConnectionWebhookTarget {
  workspaceId: string
  integrationId: string
  environment: BillingEnvironment | null
  providerAccountId: string | null
  credentials: unknown
}

/** `null` for an unknown id, another provider, a disabled connector, or no credentials. */
export async function connectionWebhookTarget(
  provider: ApiConnectorId,
  integrationId: string,
): Promise<ConnectionWebhookTarget | null> {
  if (!isConnectable(connectorAvailability()[provider])) return null

  const [row] = await db
    .select({
      workspaceId: integrations.workspaceId,
      environment: integrations.environment,
      providerAccountId: integrations.providerAccountId,
      encryptedCredentials: integrations.encryptedCredentials,
    })
    .from(integrations)
    .where(and(eq(integrations.id, integrationId), eq(integrations.provider, provider)))
    .limit(1)

  if (!row?.encryptedCredentials) return null
  try {
    return {
      workspaceId: row.workspaceId,
      integrationId,
      environment: row.environment,
      providerAccountId: row.providerAccountId,
      credentials: JSON.parse(decryptSecret(row.encryptedCredentials)),
    }
  } catch {
    // Wrong ENCRYPTION_KEY or a malformed row: fail closed, say which connection only.
    logger.error("billing connection credentials unreadable", { provider, workspaceId: row.workspaceId, integrationId })
    return null
  }
}

/**
 * Learns the provider account from a verified delivery (Mercado Pago's
 * `user_id`) the first time one arrives. An account already taken by another
 * connection of the workspace is left alone.
 */
export async function noteConnectionAccount(integrationId: string, providerAccountId: string): Promise<void> {
  try {
    await db
      .update(integrations)
      .set({ providerAccountId, updatedAt: new Date() })
      .where(and(eq(integrations.id, integrationId), sql`${integrations.providerAccountId} is null`))
  } catch (error) {
    logger.warn("could not record the connection's provider account", { integrationId, error })
  }
}

/** The existing Stripe helper is provider-agnostic; re-exported under the connection name. */
export { recordWebhookRejection as recordConnectionRejection } from "./integrations"
