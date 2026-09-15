import "server-only"

import { and, desc, eq, isNull, sql } from "drizzle-orm"

import { apiKeyEnvironment, generateApiKey, peppered, type ApiKeyEnvironment } from "@/lib/crypto/hash"
import { db, withUser, type DbClient } from "@/server/db"
import { apiKeys } from "@/server/db/schema"
import { UnauthorizedError } from "@/server/policies/errors"
import { atLeast, requireMembership, type WorkspaceRole } from "@/server/policies/workspace"

import { recordAudit } from "./audit"
import { assertLiveMode, canUseFeature, getWorkspaceEntitlements } from "./entitlements"

export type { ApiKeyEnvironment } from "@/lib/crypto/hash"

export interface IssuedKey {
  id: string
  type: "publishable" | "secret"
  environment: ApiKeyEnvironment
  /** Returned exactly once. Never stored, never logged. */
  plaintext: string
  prefix: string
}

/**
 * Mints a publishable + secret pair and returns both plaintexts. Only for a
 * caller that shows or prints them straight away — today the demo seed.
 * Workspace creation deliberately does not call it: a key whose plaintext is
 * discarded can never be used (UI_UX_FUNCTIONAL_FINDINGS F1).
 */
export async function createApiKeyPair(
  tx: DbClient,
  workspaceId: string,
  userId: string,
  environment: ApiKeyEnvironment = "test",
): Promise<IssuedKey[]> {
  const issued: IssuedKey[] = []

  for (const type of ["publishable", "secret"] as const) {
    const key = generateApiKey(type, environment)
    const [row] = await tx
      .insert(apiKeys)
      .values({
        workspaceId,
        name: type === "secret" ? "Default secret key" : "Default publishable key",
        type,
        environment,
        keyPrefix: key.prefix,
        keyHash: key.hash,
        createdBy: userId,
      })
      .returning({ id: apiKeys.id })

    issued.push({ id: row!.id, type, environment, plaintext: key.plaintext, prefix: key.prefix })
  }

  return issued
}

/**
 * Who may see and generate API keys: the same `admin` floor `listApiKeys` and
 * `rotateApiKey` enforce. Pages use it to avoid calling them for a `member`,
 * who gets a read-only view instead of an error.
 */
export function canManageApiKeys(role: WorkspaceRole): boolean {
  return atLeast(role, "admin")
}

export interface ApiKeysView {
  keys: Array<{
    id: string
    name: string
    type: "publishable" | "secret"
    environment: ApiKeyEnvironment
    keyPrefix: string
    lastUsedAt: Date | null
    revokedAt: Date | null
    createdAt: Date
  }>
  /** Whether live keys can be generated: a plan with live mode in good standing. */
  liveModeAvailable: boolean
}

export async function listApiKeys(userId: string, workspaceId: string): Promise<ApiKeysView> {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")
    const [keys, entitlements] = await Promise.all([
      tx
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          type: apiKeys.type,
          environment: apiKeys.environment,
          keyPrefix: apiKeys.keyPrefix,
          lastUsedAt: apiKeys.lastUsedAt,
          revokedAt: apiKeys.revokedAt,
          createdAt: apiKeys.createdAt,
        })
        .from(apiKeys)
        .where(eq(apiKeys.workspaceId, workspaceId))
        .orderBy(desc(apiKeys.createdAt)),
      getWorkspaceEntitlements(tx, workspaceId),
    ])
    return {
      keys,
      liveModeAvailable: entitlements.standing !== "restricted" && canUseFeature(entitlements, "liveMode"),
    }
  })
}

/**
 * Issues a new key of one type in one environment, revoking the active one it
 * replaces. A live key needs live mode (`LIVE_MODE_REQUIRED` /
 * `SUBSCRIPTION_REQUIRED` otherwise); test keys work on every plan.
 */
export async function rotateApiKey(
  userId: string,
  workspaceId: string,
  type: "publishable" | "secret",
  environment: ApiKeyEnvironment,
): Promise<IssuedKey> {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")
    if (environment === "live") assertLiveMode(await getWorkspaceEntitlements(tx, workspaceId))

    const revoked = await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiKeys.workspaceId, workspaceId),
          eq(apiKeys.type, type),
          eq(apiKeys.environment, environment),
          isNull(apiKeys.revokedAt),
        ),
      )
      .returning({ id: apiKeys.id })

    for (const key of revoked) {
      await recordAudit(tx, {
        workspaceId,
        actorUserId: userId,
        entityType: "api_key",
        entityId: key.id,
        action: "api_key.revoked",
        metadata: { type, environment },
      })
    }

    const key = generateApiKey(type, environment)
    const [row] = await tx
      .insert(apiKeys)
      .values({
        workspaceId,
        name: type === "secret" ? "Secret key" : "Publishable key",
        type,
        environment,
        keyPrefix: key.prefix,
        keyHash: key.hash,
        createdBy: userId,
      })
      .returning({ id: apiKeys.id })

    await recordAudit(tx, {
      workspaceId,
      actorUserId: userId,
      entityType: "api_key",
      entityId: row!.id,
      action: "api_key.created",
      metadata: { type, environment },
    })

    return { id: row!.id, type, environment, plaintext: key.plaintext, prefix: key.prefix }
  })
}

export interface AuthenticatedKey {
  workspaceId: string
  keyId: string
  type: "publishable" | "secret"
  /** Which programs the key reaches: test keys test programs, live keys live programs. */
  environment: ApiKeyEnvironment
}

/**
 * Verifies a presented key against its stored hash. Runs on the service
 * connection because the caller is a machine with no Supabase session; the key
 * itself is the credential, and it is looked up by hash, never by prefix.
 * Revoked keys, keys of the other type, and a key whose prefix names another
 * environment than its row are all simply invalid.
 */
export async function authenticateApiKey(
  presented: string,
  expected: "publishable" | "secret",
): Promise<AuthenticatedKey> {
  const trimmed = presented.trim()
  const claimed = apiKeyEnvironment(trimmed)
  if (!claimed) throw new UnauthorizedError("Malformed API key.", "apiKeyMalformed")

  const row = await findActiveKey(db, trimmed)
  if (!row || row.type !== expected || row.environment !== claimed) {
    throw new UnauthorizedError("Invalid API key.", "apiKeyInvalid")
  }

  // Best-effort usage stamp; never block the request on it.
  void db
    .update(apiKeys)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(apiKeys.id, row.id))
    .catch(() => undefined)

  return { workspaceId: row.workspaceId, keyId: row.id, type: row.type, environment: row.environment }
}

/**
 * INGEST PATH — service connection. The publishable key the tracker sends:
 * its workspace and environment, or `null` for an unknown, revoked or
 * malformed key (a revoked key must stop recording clicks the moment it is
 * rotated). The usage stamp is written at most once a minute per key, since
 * this runs on every tracked visit.
 */
export async function resolvePublishableKey(
  presented: string,
  /** For the database-backed tests, which roll everything back. */
  client: DbClient = db,
): Promise<{ workspaceId: string; environment: ApiKeyEnvironment } | null> {
  const trimmed = presented.trim()
  const claimed = apiKeyEnvironment(trimmed)
  if (!claimed || !trimmed.startsWith("pk_")) return null

  const row = await findActiveKey(client, trimmed)
  if (!row || row.type !== "publishable" || row.environment !== claimed) return null

  void client
    .update(apiKeys)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(apiKeys.id, row.id),
        sql`(${apiKeys.lastUsedAt} is null or ${apiKeys.lastUsedAt} < now() - interval '1 minute')`,
      ),
    )
    .catch(() => undefined)

  return { workspaceId: row.workspaceId, environment: row.environment }
}

async function findActiveKey(client: DbClient, plaintext: string) {
  const [row] = await client
    .select({
      id: apiKeys.id,
      workspaceId: apiKeys.workspaceId,
      type: apiKeys.type,
      environment: apiKeys.environment,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, peppered(plaintext)), isNull(apiKeys.revokedAt)))
    .limit(1)
  return row ?? null
}
