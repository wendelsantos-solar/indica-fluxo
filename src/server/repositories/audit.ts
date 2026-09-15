import "server-only"

import { desc, eq } from "drizzle-orm"

import { type DbClient } from "@/server/db"
import { auditLogs, profiles } from "@/server/db/schema"

/**
 * The most recent audit rows of a workspace, newest first, with the actor's
 * profile name where RLS lets the reader see it. `metadata` is deliberately
 * not selected: the Settings view shows who did what and when, nothing more.
 */
export async function listRecentAuditLogs(tx: DbClient, workspaceId: string, limit: number) {
  return tx
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      actorUserId: auditLogs.actorUserId,
      actorName: profiles.fullName,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(profiles, eq(profiles.id, auditLogs.actorUserId))
    .where(eq(auditLogs.workspaceId, workspaceId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
}
