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

export async function listMembers(tx: DbClient, workspaceId: string) {
  return tx
    .select({
      id: workspaceMembers.id,
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      createdAt: workspaceMembers.createdAt,
      fullName: profiles.fullName,
      avatarUrl: profiles.avatarUrl,
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
