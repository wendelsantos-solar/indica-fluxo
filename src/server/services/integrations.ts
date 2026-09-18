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
      displayName: integrations.displayName,
      connectedAt: integrations.connectedAt,
      disconnectedAt: integrations.disconnectedAt,
    })
    .from(integrations)
    .where(eq(integrations.workspaceId, workspaceId))
}

/**
 * A workspace may hold several Stripe connections (migration 0018). Functions
 * that predate that address one by id; without an id they keep their old
 * meaning — the workspace's first Stripe connection — so every caller written
 * before multi-account behaves exactly as it did.
 */
function stripeRow(workspaceId: string, integrationId?: string | null) {
  return integrationId
    ? and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, "stripe"), eq(integrations.id, integrationId))
    : and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, "stripe"))
}

/**
 * What is stored, encrypted, in `integrations.encrypted_credentials` for a
 * Stripe integration: the signing secret of the founder's LIVE endpoint
 * (`webhookSecret`, the original field — rows saved before test mode existed
 * hold live secrets, as migration 0010 marked their data live) and of the TEST
 * endpoint. Each is saved and replaced on its own. Parsed on the way out so a
 * malformed row fails closed.
 */
const stripeCredentialsSchema = z
  .object({
    webhookSecret: z.string().startsWith("whsec_").optional(),
    testWebhookSecret: z.string().startsWith("whsec_").optional(),
  })
  .refine((value) => Boolean(value.webhookSecret || value.testWebhookSecret))

type StripeCredentials = z.infer<typeof stripeCredentialsSchema>

export type StripeSecretEnvironment = "test" | "live"

const SECRET_FIELD: Record<StripeSecretEnvironment, keyof StripeCredentials> = {
  live: "webhookSecret",
  test: "testWebhookSecret",
}

function readCredentials(encrypted: string | null): StripeCredentials | null {
  if (!encrypted) return null
  const parsed = stripeCredentialsSchema.safeParse(JSON.parse(decryptSecret(encrypted)))
  return parsed.success ? parsed.data : null
}

/** Non-sensitive bookkeeping kept in `integrations.metadata`. */
const setupMetadataSchema = z.object({
  secretSavedAt: z.iso.datetime().optional().catch(undefined),
  testSecretSavedAt: z.iso.datetime().optional().catch(undefined),
  liveSecretSavedAt: z.iso.datetime().optional().catch(undefined),
  lastRejectedAt: z.iso.datetime().optional().catch(undefined),
})

export interface StripeSetup {
  integrationId: string
  status: "connected" | "disconnected" | "error" | "pending"
  providerAccountId: string | null
  /** Whether any signing secret is stored. The secrets themselves never leave the server. */
  secretSaved: boolean
  /** Which endpoint secrets are stored. */
  secrets: Record<StripeSecretEnvironment, boolean>
  /** When a secret was last saved, whichever environment. */
  secretSavedAt: Date | null
  /** Last delivery to this endpoint whose signature did not verify. */
  lastRejectedAt: Date | null
}

/** One Stripe connection of a workspace (the first, without an id), as the Integrations page needs it. Any member. */
export async function getStripeSetup(
  userId: string,
  workspaceId: string,
  integrationId?: string | null,
): Promise<StripeSetup | null> {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId)

    const [row] = await tx
      .select({
        id: integrations.id,
        status: integrations.status,
        providerAccountId: integrations.providerAccountId,
        encryptedCredentials: integrations.encryptedCredentials,
        metadata: integrations.metadata,
      })
      .from(integrations)
      .where(stripeRow(workspaceId, integrationId))
      .orderBy(integrations.createdAt)
      .limit(1)

    if (!row) return null
    const metadata = setupMetadataSchema.safeParse(row.metadata)
    const meta = metadata.success ? metadata.data : {}

    // Decrypted only to tell which fields are present; nothing is returned but booleans.
    let credentials: StripeCredentials | null = null
    try {
      credentials = readCredentials(row.encryptedCredentials)
    } catch {
      credentials = null
    }
    const secrets = {
      live: Boolean(credentials?.webhookSecret),
      test: Boolean(credentials?.testWebhookSecret),
    }

    return {
      integrationId: row.id,
      status: row.status,
      providerAccountId: row.providerAccountId,
      secretSaved: row.encryptedCredentials !== null,
      secrets,
      secretSavedAt: meta.secretSavedAt ? new Date(meta.secretSavedAt) : null,
      lastRejectedAt: meta.lastRejectedAt ? new Date(meta.lastRejectedAt) : null,
    }
  })
}

/**
 * Step 1 of the Stripe setup. The row has to exist before its webhook URL can
 * be shown, so it is created here — `disconnected` until a signing secret is
 * saved.
 *
 * With `integrationId`, that connection's account id changes (the old
 * single-connection behaviour). Without one, the account is added as a
 * connection of its own — unless the workspace already has it, which is then
 * updated in place. A workspace with no Stripe row yet gets its first.
 */
export async function startStripeIntegration(
  userId: string,
  workspaceId: string,
  providerAccountId: string,
  options: { integrationId?: string | null; displayName?: string | null } = {},
): Promise<string> {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")
    const displayName = options.displayName?.trim().slice(0, 60) || null

    if (options.integrationId) {
      const [row] = await tx
        .update(integrations)
        .set({ providerAccountId, ...(displayName ? { displayName } : {}), updatedAt: new Date() })
        .where(stripeRow(workspaceId, options.integrationId))
        .returning({ id: integrations.id })
      if (!row) throw new NotFoundError("Connection not found.", "notFound")
      return row.id
    }

    const [row] = await tx
      .insert(integrations)
      .values({
        workspaceId,
        provider: "stripe",
        providerAccountId,
        displayName,
        status: "disconnected",
        metadata: { mode: "webhook_secret", connectStartedAt: new Date().toISOString() },
      })
      .onConflictDoUpdate({
        target: [integrations.workspaceId, integrations.provider, integrations.providerAccountId],
        targetWhere: sql`provider_account_id is not null and environment is null`,
        // The same account again never makes a second row (brief §6): an
        // unfinished setup is resumed as it is; a disconnected one starts over
        // as an unfinished setup — visible, never "connected" before a secret.
        set: {
          ...(displayName ? { displayName } : {}),
          disconnectedAt: sql`case when ${integrations.status} = 'disconnected' then null else ${integrations.disconnectedAt} end`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: integrations.id })

    return row!.id
  })
}

/**
 * Step 3: stores one endpoint's signing secret — the test endpoint's or the
 * live endpoint's — encrypted (AES-256-GCM), keeping the other one, and marks
 * the integration connected. "Connected" means *configured*; whether events
 * actually arrive is `integration-health`'s job, not this status.
 */
export async function saveStripeWebhookSecret(
  userId: string,
  workspaceId: string,
  environment: StripeSecretEnvironment,
  webhookSecret: string,
  integrationId?: string | null,
): Promise<void> {
  const secret = z.string().startsWith("whsec_").parse(webhookSecret)
  const now = new Date()

  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

    const [existing] = await tx
      .select({ id: integrations.id, encryptedCredentials: integrations.encryptedCredentials })
      .from(integrations)
      .where(stripeRow(workspaceId, integrationId))
      .orderBy(integrations.createdAt)
      .limit(1)
      .for("update")

    if (!existing) {
      throw new NotFoundError("Start the Stripe integration before saving its secret.", "stripeSetupMissing")
    }

    // An unreadable row (another ENCRYPTION_KEY, a malformed value) is replaced
    // rather than merged: its secrets could not verify anything anyway.
    let current: StripeCredentials | null = null
    try {
      current = readCredentials(existing.encryptedCredentials)
    } catch {
      current = null
    }
    const field = SECRET_FIELD[environment]
    const replaced = Boolean(current?.[field])
    const credentials = stripeCredentialsSchema.parse({ ...current, [field]: secret })

    await tx
      .update(integrations)
      .set({
        encryptedCredentials: encryptSecret(JSON.stringify(credentials)),
        status: "connected",
        statusReason: null,
        connectedAt: now,
        lastVerifiedAt: now,
        disconnectedAt: null,
        // A new secret starts a clean slate: an old rejection no longer applies.
        metadata: sql`(${integrations.metadata} - 'lastRejectedAt') || ${JSON.stringify({
          mode: "webhook_secret",
          secretSavedAt: now.toISOString(),
          [environment === "live" ? "liveSecretSavedAt" : "testSecretSavedAt"]: now.toISOString(),
        })}::jsonb`,
        updatedAt: now,
      })
      .where(eq(integrations.id, existing.id))

    await recordAudit(tx, {
      workspaceId,
      actorUserId: userId,
      entityType: "integration",
      entityId: existing.id,
      action: replaced ? "integration.credentials_updated" : "integration.connected",
      metadata: { provider: "stripe", integrationId: existing.id, environment, secretReplaced: replaced },
    })
  })
}

/**
 * Disconnects the workspace's first connection of `provider` — the
 * pre-multi-account entry point, kept for its callers. New code disconnects a
 * connection by id through `billing-connections.ts`.
 */
export async function disconnectIntegration(
  userId: string,
  workspaceId: string,
  provider: BillingProviderId,
): Promise<void> {
  const [row] = await withUser(userId, (tx) =>
    tx
      .select({ id: integrations.id })
      .from(integrations)
      .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, provider)))
      .orderBy(integrations.createdAt)
      .limit(1),
  )
  if (!row) {
    await withUser(userId, (tx) => requireMembership(tx, workspaceId, userId, "admin"))
    return
  }
  const { disconnectBillingConnection } = await import("./billing-connections")
  await disconnectBillingConnection(userId, workspaceId, row.id)
}

/**
 * INGEST PATH ONLY — service connection, RLS bypassed.
 *
 * Called by `POST /api/webhooks/stripe/<integrationId>`, whose caller is
 * Stripe, not a user: there is no session to impersonate, and the decrypted
 * secrets are what authenticate the delivery (ARCHITECTURE.md §2). They are
 * returned to the route for verification only and are never logged.
 *
 * `null` for an unknown id, a non-Stripe integration, or one without a secret.
 */
export async function webhookTargetForIntegration(
  integrationId: string,
): Promise<{ workspaceId: string; secrets: { test: string | null; live: string | null } } | null> {
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
    const credentials = readCredentials(row.encryptedCredentials)
    if (!credentials) throw new Error("malformed credentials")
    return {
      workspaceId: row.workspaceId,
      secrets: { live: credentials.webhookSecret ?? null, test: credentials.testWebhookSecret ?? null },
    }
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
