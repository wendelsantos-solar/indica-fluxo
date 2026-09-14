import "server-only"

import { and, eq } from "drizzle-orm"

import { type DbClient } from "@/server/db"
import { workspaceMembers } from "@/server/db/schema"

import { ForbiddenError } from "./errors"

export type WorkspaceRole = "owner" | "admin" | "member"

const RANK: Record<WorkspaceRole, number> = { member: 1, admin: 2, owner: 3 }

export function atLeast(role: WorkspaceRole, required: WorkspaceRole): boolean {
  return RANK[role] >= RANK[required]
}

/**
 * RLS is the real boundary. This exists so the UI can fail with a sentence
 * instead of an empty result set, and to express role rules Postgres policies
 * express awkwardly.
 */
export async function requireMembership(
  tx: DbClient,
  workspaceId: string,
  userId: string,
  required: WorkspaceRole = "member",
): Promise<WorkspaceRole> {
  const [membership] = await tx
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1)

  if (!membership) throw new ForbiddenError()
  if (!atLeast(membership.role, required)) {
    throw new ForbiddenError(`This action requires the ${required} role.`)
  }
  return membership.role
}
