import "server-only"

import { and, eq, sql } from "drizzle-orm"

import { slugify } from "@/lib/utils"
import { db, withUser } from "@/server/db"
import { workspaceInvites, workspaceMembers, workspaces } from "@/server/db/schema"
import { ConflictError, NotFoundError, ValidationError } from "@/server/policies/errors"
import { requireMembership } from "@/server/policies/workspace"
import { findWorkspaceBySlug, listWorkspacesForUser } from "@/server/repositories/workspaces"

import { recordAudit } from "./audit"
import { createApiKeyPair } from "./api-keys"

export interface CreateWorkspaceInput {
  name: string
  defaultCurrency: string
  timezone: string
}

/**
 * Onboarding. Uses the service connection for one specific reason: the owner
 * membership has to exist in the same transaction as the workspace, and no
 * self-referential RLS policy can authorise inserting the row that would grant
 * the very access being checked. Everything after this point runs under RLS.
 */
export async function createWorkspace(
  userId: string,
  input: CreateWorkspaceInput,
): Promise<{ id: string; slug: string }> {
  const base = slugify(input.name)
  if (!base) throw new ValidationError("Workspace name must contain letters or numbers.", {}, "workspaceNameInvalid")

  return db.transaction(async (tx) => {
    const slug = await uniqueSlug(tx, base)

    const [workspace] = await tx
      .insert(workspaces)
      .values({
        name: input.name.trim(),
        slug,
        defaultCurrency: input.defaultCurrency.toUpperCase(),
        timezone: input.timezone,
      })
      .returning({ id: workspaces.id, slug: workspaces.slug })

    if (!workspace) throw new ConflictError("Could not create the workspace.", "workspaceNotCreated")

    await tx.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId,
      role: "owner",
    })

    // A workspace without keys cannot install tracking, so mint them up front.
    await createApiKeyPair(tx, workspace.id, userId)

    await recordAudit(tx, {
      workspaceId: workspace.id,
      actorUserId: userId,
      entityType: "workspace",
      entityId: workspace.id,
      action: "workspace.created",
      metadata: { name: input.name, currency: input.defaultCurrency },
    })

    return workspace
  })
}

async function uniqueSlug(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  base: string,
): Promise<string> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`
    const [existing] = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, candidate))
      .limit(1)
    if (!existing) return candidate
  }
  return `${base}-${Math.random().toString(36).slice(2, 8)}`
}

export async function getWorkspaceForUser(userId: string, slug: string) {
  const workspace = await withUser(userId, (tx) => findWorkspaceBySlug(tx, slug, userId))
  if (!workspace) throw new NotFoundError("Workspace not found, or you do not have access to it.", "workspaceNotFound")
  return workspace
}

export async function listUserWorkspaces(userId: string) {
  return withUser(userId, (tx) => listWorkspacesForUser(tx, userId))
}

export async function updateWorkspace(
  userId: string,
  workspaceId: string,
  input: { name: string; defaultCurrency: string; timezone: string },
) {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

    await tx
      .update(workspaces)
      .set({
        name: input.name.trim(),
        defaultCurrency: input.defaultCurrency.toUpperCase(),
        timezone: input.timezone,
      })
      .where(eq(workspaces.id, workspaceId))

    await recordAudit(tx, {
      workspaceId,
      actorUserId: userId,
      entityType: "workspace",
      entityId: workspaceId,
      action: "workspace.updated",
    })
  })
}

export async function inviteMember(
  userId: string,
  workspaceId: string,
  input: { email: string; role: "admin" | "member" },
) {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

    const email = input.email.trim().toLowerCase()

    const [existing] = await tx
      .select({ id: workspaceInvites.id })
      .from(workspaceInvites)
      .where(
        and(
          eq(workspaceInvites.workspaceId, workspaceId),
          sql`lower(${workspaceInvites.email}) = ${email}`,
          sql`${workspaceInvites.acceptedAt} is null`,
        ),
      )
      .limit(1)

    if (existing) throw new ConflictError("That person already has a pending invitation.", "invitePending")

    await tx.insert(workspaceInvites).values({
      workspaceId,
      email,
      role: input.role,
      invitedBy: userId,
    })

    await recordAudit(tx, {
      workspaceId,
      actorUserId: userId,
      entityType: "workspace_invite",
      action: "member.invited",
      metadata: { role: input.role },
    })
  })
}
