import "server-only"

import { and, desc, eq, isNull, sql } from "drizzle-orm"

import { generateApiKey, peppered } from "@/lib/crypto/hash"
import { db, withUser, type DbClient } from "@/server/db"
import { apiKeys } from "@/server/db/schema"
import { UnauthorizedError } from "@/server/policies/errors"
import { requireMembership } from "@/server/policies/workspace"

import { recordAudit } from "./audit"

export interface IssuedKey {
  id: string
  type: "publishable" | "secret"
  /** Returned exactly once. Never stored, never logged. */
  plaintext: string
  prefix: string
}

export async function createApiKeyPair(
  tx: DbClient,
  workspaceId: string,
  userId: string,
): Promise<IssuedKey[]> {
  const issued: IssuedKey[] = []

  for (const type of ["publishable", "secret"] as const) {
    const key = generateApiKey(type)
    const [row] = await tx
      .insert(apiKeys)
      .values({
        workspaceId,
        name: type === "secret" ? "Default secret key" : "Default publishable key",
        type,
        keyPrefix: key.prefix,
        keyHash: key.hash,
        createdBy: userId,
      })
      .returning({ id: apiKeys.id })

    issued.push({ id: row!.id, type, plaintext: key.plaintext, prefix: key.prefix })
  }

  return issued
}

export async function listApiKeys(userId: string, workspaceId: string) {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")
    return tx
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        type: apiKeys.type,
        keyPrefix: apiKeys.keyPrefix,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.workspaceId, workspaceId))
      .orderBy(desc(apiKeys.createdAt))
  })
}

export async function rotateApiKey(
  userId: string,
  workspaceId: string,
  type: "publishable" | "secret",
): Promise<IssuedKey> {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

    await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(apiKeys.workspaceId, workspaceId), eq(apiKeys.type, type), isNull(apiKeys.revokedAt)),
      )

    const key = generateApiKey(type)
    const [row] = await tx
      .insert(apiKeys)
      .values({
        workspaceId,
        name: type === "secret" ? "Secret key" : "Publishable key",
        type,
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
      metadata: { type },
    })

    return { id: row!.id, type, plaintext: key.plaintext, prefix: key.prefix }
  })
}

export interface AuthenticatedKey {
  workspaceId: string
  keyId: string
  type: "publishable" | "secret"
}

/**
 * Verifies a presented key against its stored hash. Runs on the service
 * connection because the caller is a machine with no Supabase session; the key
 * itself is the credential, and it is looked up by hash, never by prefix.
 */
export async function authenticateApiKey(
  presented: string,
  expected: "publishable" | "secret",
): Promise<AuthenticatedKey> {
  const trimmed = presented.trim()
  if (!/^(pk|sk)_(live|test)_[A-Za-z0-9_-]{10,}$/.test(trimmed)) {
    throw new UnauthorizedError("Malformed API key.")
  }

  const [row] = await db
    .select({
      id: apiKeys.id,
      workspaceId: apiKeys.workspaceId,
      type: apiKeys.type,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, peppered(trimmed)), isNull(apiKeys.revokedAt)))
    .limit(1)

  if (!row || row.type !== expected) throw new UnauthorizedError("Invalid API key.")

  // Best-effort usage stamp; never block the request on it.
  void db
    .update(apiKeys)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(apiKeys.id, row.id))
    .catch(() => undefined)

  return { workspaceId: row.workspaceId, keyId: row.id, type: row.type }
}
