import "server-only"

import { and, asc, eq, sql } from "drizzle-orm"

import { type DbClient } from "@/server/db"
import { profiles, workspaceInvites, workspaceMembers, workspaces } from "@/server/db/schema"

export interface WorkspaceSummary {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  defaultCurrency: string
  timezone: string
  role: "owner" | "admin" | "member"
}

export async function listWorkspacesForUser(
  tx: DbClient,
  userId: string,
): Promise<WorkspaceSummary[]> {
  return tx
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      logoUrl: workspaces.logoUrl,
      defaultCurrency: workspaces.defaultCurrency,
      timezone: workspaces.timezone,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaces.name))
}

export async function findWorkspaceBySlug(
  tx: DbClient,
  slug: string,
  userId: string,
): Promise<WorkspaceSummary | null> {
  const [row] = await tx
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      logoUrl: workspaces.logoUrl,
      defaultCurrency: workspaces.defaultCurrency,
      timezone: workspaces.timezone,
      role: workspaceMembers.role,
    })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, userId)),
    )
    .where(eq(workspaces.slug, slug))
    .limit(1)

  return row ?? null
}

export async function slugExists(tx: DbClient, slug: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .limit(1)
  return Boolean(row)
}

export async function findWorkspaceName(tx: DbClient, workspaceId: string): Promise<string | null> {
  const [row] = await tx
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1)
  return row?.name ?? null
}

/**
 * Members of a workspace, with what can be known about each under RLS.
 *
 * - `fullName` comes from `profiles`, whose policy only lets a person read
 *   their own row, so it is null for everyone but the reader.
 * - `inviteEmail` is the address of the invitation this membership came
 *   from. `handle_new_user()` inserts the membership and stamps the invite's
 *   `accepted_at` in one statement batch, so both carry the same `now()`
 *   (transaction time) — that equality is the link, as the invite row has no
 *   user id. Invites are readable by owners and admins only, so it is null for
 *   a plain member, and for anyone who did not join through an invitation
 *   (the workspace creator).
 */
export async function listMembers(tx: DbClient, workspaceId: string) {
  return tx
    .select({
      id: workspaceMembers.id,
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      createdAt: workspaceMembers.createdAt,
      fullName: profiles.fullName,
      avatarUrl: profiles.avatarUrl,
      inviteEmail: sql<string | null>`(
        select ${workspaceInvites.email} from ${workspaceInvites}
         where ${workspaceInvites.workspaceId} = ${workspaceMembers.workspaceId}
           and ${workspaceInvites.acceptedAt} = ${workspaceMembers.createdAt}
         order by ${workspaceInvites.createdAt}
         limit 1
      )`,
    })
    .from(workspaceMembers)
    .leftJoin(profiles, eq(profiles.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(workspaceMembers.createdAt))
}

export async function listPendingInvites(tx: DbClient, workspaceId: string) {
  return tx
    .select({
      id: workspaceInvites.id,
      email: workspaceInvites.email,
      role: workspaceInvites.role,
      createdAt: workspaceInvites.createdAt,
    })
    .from(workspaceInvites)
    .where(
      and(
        eq(workspaceInvites.workspaceId, workspaceId),
        sql`${workspaceInvites.acceptedAt} is null`,
      ),
    )
    .orderBy(asc(workspaceInvites.createdAt))
}

export async function findMember(tx: DbClient, workspaceId: string, memberId: string) {
  const [row] = await tx
    .select({ id: workspaceMembers.id, userId: workspaceMembers.userId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.id, memberId), eq(workspaceMembers.workspaceId, workspaceId)))
    .limit(1)
  return row ?? null
}

/**
 * Locks the owner rows, so two owners demoting each other at the same moment
 * cannot both see "another owner remains" and leave the workspace with none.
 */
export async function lockOwners(tx: DbClient, workspaceId: string): Promise<number> {
  const rows = await tx
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, "owner")))
    .for("update")
  return rows.length
}

export async function findPendingInvite(tx: DbClient, workspaceId: string, inviteId: string) {
  const [row] = await tx
    .select({ id: workspaceInvites.id, email: workspaceInvites.email, role: workspaceInvites.role })
    .from(workspaceInvites)
    .where(
      and(
        eq(workspaceInvites.id, inviteId),
        eq(workspaceInvites.workspaceId, workspaceId),
        sql`${workspaceInvites.acceptedAt} is null`,
      ),
    )
    .limit(1)
  return row ?? null
}
