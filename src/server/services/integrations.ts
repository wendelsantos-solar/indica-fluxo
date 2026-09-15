import "server-only"

import { and, eq, sql } from "drizzle-orm"
import { z } from "zod"

import type { BillingProviderId } from "@/lib/billing/types"
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets"
import { logger } from "@/lib/logger"
import { db, withUser, type Transaction } from "@/server/db"
import { integrations } from "@/server/db/schema"
import { NotFoundError } from "@/server/policies/errors"
import { requireMembership } from "@/server/policies/workspace"

import { recordAudit } from "./audit"

export async function listIntegrations(tx: Transaction, workspaceId: string) {
  return tx
    .select({
      id: integrations.id,
      provider: integrations.provider,
      status: integrations.status,
      providerAccountId: integrations.providerAccountId,
      connectedAt: integrations.connectedAt,
      disconnectedAt: integrations.disconnectedAt,
    })
    .from(integrations)
    .where(eq(integrations.workspaceId, workspaceId))
}

/**
 * What is stored, encrypted, in `integrations.encrypted_credentials` for a
 * Stripe integration. Parsed on the way out so a malformed row fails closed.
 */
const stripeCredentialsSchema = z.object({ webhookSecret: z.string().startsWith("whsec_") })

/** Non-sensitive bookkeeping kept in `integrations.metadata`. */
const setupMetadataSchema = z.object({
  secretSavedAt: z.iso.datetime().optional().catch(undefined),
  lastRejectedAt: z.iso.datetime().optional().catch(undefined),
})

export interface StripeSetup {
  integrationId: string
  status: "connected" | "disconnected" | "error"
  providerAccountId: string | null
  /** Whether a signing secret is stored. The secret itself never leaves the server. */
  secretSaved: boolean
  secretSavedAt: Date | null
  /** Last delivery to this endpoint whose signature did not verify. */
  lastRejectedAt: Date | null
}

/** The Stripe integration of a workspace, as the Integrations page needs it. Any member. */
export async function getStripeSetup(userId: string, workspaceId: string): Promise<StripeSetup | null> {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId)

    const [row] = await tx
      .select({
        id: integrations.id,
        status: integrations.status,
        providerAccountId: integrations.providerAccountId,
        secretSaved: sql<boolean>`${integrations.encryptedCredentials} is not null`,
        metadata: integrations.metadata,
      })
      .from(integrations)
      .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, "stripe")))
      .limit(1)

    if (!row) return null
    const metadata = setupMetadataSchema.safeParse(row.metadata)
    const meta = metadata.success ? metadata.data : {}

    return {
      integrationId: row.id,
      status: row.status,
      providerAccountId: row.providerAccountId,
      secretSaved: row.secretSaved,
      secretSavedAt: meta.secretSavedAt ? new Date(meta.secretSavedAt) : null,
      lastRejectedAt: meta.lastRejectedAt ? new Date(meta.lastRejectedAt) : null,
    }
  })
}

/**
 * Step 1 of the Stripe setup. The row has to exist before its webhook URL can
 * be shown, so it is created here — `disconnected` until a signing secret is
 * saved. An existing integration keeps its status; only the account id changes.
 */
export async function startStripeIntegration(
  userId: string,
  workspaceId: string,
  providerAccountId: string,
): Promise<string> {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

    const [row] = await tx
      .insert(integrations)
      .values({
        workspaceId,
        provider: "stripe",
        providerAccountId,
        status: "disconnected",
        metadata: { mode: "webhook_secret" },
      })
      .onConflictDoUpdate({
        target: [integrations.workspaceId, integrations.provider],
        set: { providerAccountId, updatedAt: new Date() },
      })
      .returning({ id: integrations.id })

    return row!.id
  })
}

/**
 * Step 3: stores the endpoint's signing secret, encrypted (AES-256-GCM), and
 * marks the integration connected. "Connected" means *configured*; whether
 * events actually arrive is `integration-health`'s job, not this status.
 */
export async function saveStripeWebhookSecret(
  userId: string,
  workspaceId: string,
  webhookSecret: string,
): Promise<void> {
  const credentials = stripeCredentialsSchema.parse({ webhookSecret })
  const encrypted = encryptSecret(JSON.stringify(credentials))
  const now = new Date()

  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

    const [existing] = await tx
      .select({ id: integrations.id, secretSaved: sql<boolean>`${integrations.encryptedCredentials} is not null` })
      .from(integrations)
      .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, "stripe")))
      .limit(1)

    if (!existing) {
      throw new NotFoundError("Start the Stripe integration before saving its secret.", "stripeSetupMissing")
    }

    await tx
      .update(integrations)
      .set({
        encryptedCredentials: encrypted,
        status: "connected",
        connectedAt: now,
        disconnectedAt: null,
        // A new secret starts a clean slate: an old rejection no longer applies.
        metadata: sql`(${integrations.metadata} - 'lastRejectedAt') || ${JSON.stringify({
          mode: "webhook_secret",
          secretSavedAt: now.toISOString(),
        })}::jsonb`,
        updatedAt: now,
      })
      .where(eq(integrations.id, existing.id))

    await recordAudit(tx, {
      workspaceId,
      actorUserId: userId,
      entityType: "integration",
      entityId: existing.id,
      action: "integration.connected",
      metadata: { provider: "stripe", secretReplaced: existing.secretSaved },
    })
  })
}

export async function disconnectIntegration(
  userId: string,
  workspaceId: string,
  provider: BillingProviderId,
): Promise<void> {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

    await tx
      .update(integrations)
      .set({
        status: "disconnected",
        disconnectedAt: new Date(),
        // Credentials are dropped on disconnect; nothing to leak afterwards.
        encryptedCredentials: null,
        metadata: sql`${integrations.metadata} - 'secretSavedAt' - 'lastRejectedAt'`,
      })
      .where(
        and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, provider)),
      )

    await recordAudit(tx, {
      workspaceId,
      actorUserId: userId,
      entityType: "integration",
      action: "integration.disconnected",
      metadata: { provider },
    })
  })
}

/**
 * INGEST PATH ONLY — service connection, RLS bypassed.
 *
 * Called by `POST /api/webhooks/stripe/<integrationId>`, whose caller is
 * Stripe, not a user: there is no session to impersonate, and the decrypted
 * secret is what authenticates the delivery (ARCHITECTURE.md §2). The secret
 * is returned to the route for verification only and is never logged.
 *
 * `null` for an unknown id, a non-Stripe integration, or one without a secret.
 */
export async function webhookTargetForIntegration(
  integrationId: string,
): Promise<{ workspaceId: string; webhookSecret: string } | null> {
  const [row] = await db
    .select({
      workspaceId: integrations.workspaceId,
      encryptedCredentials: integrations.encryptedCredentials,
    })
    .from(integrations)
    .where(and(eq(integrations.id, integrationId), eq(integrations.provider, "stripe")))
    .limit(1)

  if (!row?.encryptedCredentials) return null

  try {
    const credentials = stripeCredentialsSchema.parse(JSON.parse(decryptSecret(row.encryptedCredentials)))
    return { workspaceId: row.workspaceId, webhookSecret: credentials.webhookSecret }
  } catch {
    // Wrong ENCRYPTION_KEY or a malformed row: fail closed, say which integration only.
    logger.error("stripe integration credentials unreadable", {
      provider: "stripe",
      workspaceId: row.workspaceId,
    })
    return null
  }
}

/**
 * INGEST PATH ONLY — service connection, RLS bypassed (same caller as above).
 *
 * Stamps the time of a delivery whose signature did not verify, so the founder
 * sees "wrong secret" instead of waiting forever for a first event. At most one
 * write a minute per integration, so a flood of bad requests is not a flood of
 * writes. Never fails the response.
 */
export async function recordWebhookRejection(integrationId: string, now = new Date()): Promise<void> {
  try {
    await db
      .update(integrations)
      .set({
        metadata: sql`${integrations.metadata} || ${JSON.stringify({ lastRejectedAt: now.toISOString() })}::jsonb`,
      })
      .where(
        and(
          eq(integrations.id, integrationId),
          sql`(${integrations.metadata}->>'lastRejectedAt' is null
               or (${integrations.metadata}->>'lastRejectedAt')::timestamptz < ${now.toISOString()}::timestamptz - interval '1 minute')`,
        ),
      )
  } catch (error) {
    logger.error("could not record webhook rejection", { provider: "stripe", error })
  }
}
