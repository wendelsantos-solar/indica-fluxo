import "server-only"

import { and, eq, sql } from "drizzle-orm"
import { cache } from "react"

import type { Locale } from "@/i18n/routing"
import { logger } from "@/lib/logger"
import { slugify } from "@/lib/utils"
import { db, withUser } from "@/server/db"
import { workspaceInvites, workspaceMembers, workspaces } from "@/server/db/schema"
import { checkMemberChange, type MemberChange } from "@/server/domain/invites"
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/policies/errors"
import { requireMembership, type WorkspaceRole } from "@/server/policies/workspace"
import {
  findMember,
  findPendingInvite,
  findWorkspaceBySlug,
  findWorkspaceName,
  listMembers,
  listPendingInvites,
  listWorkspacesForUser,
  lockOwners,
  renewInvite,
} from "@/server/repositories/workspaces"

import { recordAudit } from "./audit"
import { assertCanCreate, assertWithinLimit, getWorkspaceEntitlements } from "./entitlements"
import { sendInviteEmail, type InviteDelivery } from "./invite-mail"

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

    // No API keys are minted here. Only a key's hash is stored and its
    // plaintext is shown once, so a key issued before anyone can see it is
    // unusable. The Integrations page generates the first key on request and
    // reveals it once (UI_UX_FUNCTIONAL_FINDINGS F1).

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

/**
 * `cache()` makes these one lookup per request: the workspace layout and its
 * page (rendered concurrently) and `generateMetadata` all ask for the same
 * workspace. Outside a React render (server actions) it is a plain call.
 */
export const getWorkspaceForUser = cache(async (userId: string, slug: string) => {
  const workspace = await withUser(userId, (tx) => findWorkspaceBySlug(tx, slug, userId))
  if (!workspace) throw new NotFoundError("Workspace not found, or you do not have access to it.", "workspaceNotFound")
  return workspace
})

export const listUserWorkspaces = cache(async (userId: string) => {
  return withUser(userId, (tx) => listWorkspacesForUser(tx, userId))
})

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

/**
 * Invites a teammate by e-mail, then sends the invitation e-mail once the row
 * is committed. The row is what grants access: `handle_new_user()` claims it
 * when an account is created for that address (which, for a new address, is
 * the moment Supabase sends the e-mail — see `sendInviteEmail`).
 *
 * Known gap: an address that already has an account is never claimed, because
 * the trigger only runs when an auth user is created. The result reports
 * `accountExists` so the UI can say so.
 */
export async function inviteMember(
  userId: string,
  workspaceId: string,
  input: { email: string; role: "admin" | "member" },
  locale: Locale,
): Promise<InviteDelivery & { email: string }> {
  const email = input.email.trim().toLowerCase()

  const workspaceName = await withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")
    const entitlements = await getWorkspaceEntitlements(tx, workspaceId)
    assertCanCreate(entitlements)

    const [existing] = await tx
      .select({ id: workspaceInvites.id, expired: sql<boolean>`${workspaceInvites.expiresAt} <= now()` })
      .from(workspaceInvites)
      .where(
        and(
          eq(workspaceInvites.workspaceId, workspaceId),
          sql`lower(${workspaceInvites.email}) = ${email}`,
          sql`${workspaceInvites.acceptedAt} is null`,
        ),
      )
      .limit(1)
      .for("update")

    if (existing && !existing.expired) {
      throw new ConflictError("That person already has a pending invitation.", "invitePending")
    }

    // Members counts people in the workspace plus invitations still valid; an
    // expired one no longer counts, so inviting that address again takes a slot.
    await assertWithinLimit(tx, workspaceId, entitlements, "members")

    let inviteId: string | null
    if (existing) {
      // One unaccepted invitation per address (`workspace_invites_pending_key`):
      // the expired row is renewed with the new role rather than duplicated.
      await renewInvite(tx, existing.id, { role: input.role, invitedBy: userId })
      inviteId = existing.id
    } else {
      const [invite] = await tx
        .insert(workspaceInvites)
        .values({
          workspaceId,
          email,
          role: input.role,
          invitedBy: userId,
        })
        .returning({ id: workspaceInvites.id })
      inviteId = invite?.id ?? null
    }

    await recordAudit(tx, {
      workspaceId,
      actorUserId: userId,
      entityType: "workspace_invite",
      entityId: inviteId,
      action: "member.invited",
      metadata: { role: input.role, renewed: Boolean(existing) },
    })

    return (await findWorkspaceName(tx, workspaceId)) ?? ""
  })

  const delivery = await sendInviteEmail({ email, locale, audience: "member", workspaceName })
  return { ...delivery, email }
}

// ---------------------------------------------------------------------------
// Team management (Settings → Team)
// ---------------------------------------------------------------------------

export interface TeamMember {
  id: string
  userId: string
  role: WorkspaceRole
  joinedAt: Date
  /** Readable for the reader's own row only (`profiles` RLS). */
  name: string | null
  /** The reader's own address, or the address of the invitation they accepted. */
  email: string | null
  isYou: boolean
}

export interface PendingInvite {
  id: string
  email: string
  role: WorkspaceRole
  invitedAt: Date
  expiresAt: Date
  /** No longer claimable and not counted toward the members limit; resend renews it. */
  expired: boolean
}

export interface Team {
  members: TeamMember[]
  /** Empty for a plain member: invitations are visible to owners and admins only. */
  invites: PendingInvite[]
  viewerRole: WorkspaceRole
  ownerCount: number
}

/** What the Settings team panel renders. */
export async function getTeam(
  viewer: { id: string; email: string; name: string | null },
  workspaceId: string,
): Promise<Team> {
  return withUser(viewer.id, async (tx) => {
    const viewerRole = await requireMembership(tx, workspaceId, viewer.id)
    const [members, invites] = await Promise.all([
      listMembers(tx, workspaceId),
      listPendingInvites(tx, workspaceId),
    ])

    return {
      viewerRole,
      ownerCount: members.filter((member) => member.role === "owner").length,
      members: members.map((member) => {
        const isYou = member.userId === viewer.id
        return {
          id: member.id,
          userId: member.userId,
          role: member.role,
          joinedAt: member.createdAt,
          name: member.fullName ?? (isYou ? viewer.name : null),
          email: isYou ? viewer.email : member.inviteEmail,
          isYou,
        }
      }),
      invites: invites.map((invite) => ({
        id: invite.id,
        email: invite.email,
        role: invite.role,
        invitedAt: invite.createdAt,
        expiresAt: invite.expiresAt,
        expired: invite.expired,
      })),
    }
  })
}

async function applyMemberChange(
  userId: string,
  workspaceId: string,
  memberId: string,
  change: MemberChange,
): Promise<{ self: boolean }> {
  return withUser(userId, async (tx) => {
    // Any member may reach this far: leaving is open to every role, and
    // `checkMemberChange` refuses a plain member everything else.
    const actorRole = await requireMembership(tx, workspaceId, userId)

    const target = await findMember(tx, workspaceId, memberId)
    if (!target) throw new NotFoundError("Member not found.", "memberNotFound")
    const self = target.userId === userId

    const ownerCount = target.role === "owner" ? await lockOwners(tx, workspaceId) : 0
    const verdict = checkMemberChange({ actorRole, targetRole: target.role, ownerCount, change, self })
    if (!verdict.ok) {
      throw verdict.reason === "lastOwner"
        ? new ConflictError("A workspace needs at least one owner.", "lastOwner")
        : new ForbiddenError("Only an owner can change another owner.", verdict.reason)
    }

    if (change.kind === "remove") {
      // Audited before the write: someone leaving the workspace can no longer
      // insert into its audit log once their membership row is gone. A plain
      // member leaving is refused by the `audit_logs` insert policy (owners and
      // admins only); in a savepoint, so that refusal is logged, not fatal.
      await tx
        .transaction((savepoint) =>
          recordAudit(savepoint, {
            workspaceId,
            actorUserId: userId,
            entityType: "workspace_member",
            entityId: target.id,
            action: "member.removed",
            metadata: { role: target.role, self },
          }),
        )
        .catch((error: unknown) => {
          if (!self || actorRole !== "member") throw error
          logger.warn("member.removed audit not recorded", {
            workspaceId,
            error: error instanceof Error ? error.message : "unknown",
          })
        })
      const deleted = await tx
        .delete(workspaceMembers)
        .where(eq(workspaceMembers.id, target.id))
        .returning({ id: workspaceMembers.id })
      // RLS matched nothing: the delete policy does not cover this reader.
      if (deleted.length === 0) throw new ForbiddenError("You cannot remove this member.", "memberChangeForbidden")
    } else if (change.to !== target.role) {
      await recordAudit(tx, {
        workspaceId,
        actorUserId: userId,
        entityType: "workspace_member",
        entityId: target.id,
        action: "member.role_changed",
        metadata: { from: target.role, to: change.to },
      })
      await tx.update(workspaceMembers).set({ role: change.to }).where(eq(workspaceMembers.id, target.id))
    }

    return { self }
  })
}

/** Owner or admin; never makes an owner and never demotes the last one. */
export async function changeMemberRole(
  userId: string,
  workspaceId: string,
  memberId: string,
  role: "admin" | "member",
): Promise<{ self: boolean }> {
  return applyMemberChange(userId, workspaceId, memberId, { kind: "role", to: role })
}

/**
 * Owner or admin removes someone; anyone may remove themselves (leave). The
 * last owner cannot be removed, not even by themselves. `self` means the reader
 * just left the workspace and has no access to it.
 */
export async function removeMember(
  userId: string,
  workspaceId: string,
  memberId: string,
): Promise<{ self: boolean }> {
  return applyMemberChange(userId, workspaceId, memberId, { kind: "remove" })
}

/** Deletes a pending invitation. An accepted one is a membership: remove that instead. */
export async function revokeInvite(userId: string, workspaceId: string, inviteId: string): Promise<void> {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

    const invite = await findPendingInvite(tx, workspaceId, inviteId)
    if (!invite) throw new NotFoundError("Invitation not found.", "inviteNotFound")

    await tx.delete(workspaceInvites).where(eq(workspaceInvites.id, invite.id))
    // No e-mail in the metadata: the log outlives the invitation.
    await recordAudit(tx, {
      workspaceId,
      actorUserId: userId,
      entityType: "workspace_invite",
      entityId: invite.id,
      action: "member.invite_revoked",
      metadata: { role: invite.role },
    })
  })
}

/**
 * Sends the invitation e-mail for a pending invitation again and gives it a
 * fresh 14 days. An expired invitation stopped counting toward the members
 * limit, so renewing it takes a slot again and is checked; a valid one already
 * holds its slot.
 */
export async function resendMemberInvite(
  userId: string,
  workspaceId: string,
  inviteId: string,
  locale: Locale,
): Promise<InviteDelivery & { email: string }> {
  const { invite, workspaceName } = await withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")
    const entitlements = await getWorkspaceEntitlements(tx, workspaceId)
    assertCanCreate(entitlements)

    const found = await findPendingInvite(tx, workspaceId, inviteId)
    if (!found) throw new NotFoundError("Invitation not found.", "inviteNotFound")

    if (found.expired) await assertWithinLimit(tx, workspaceId, entitlements, "members")
    await renewInvite(tx, found.id)

    return { invite: found, workspaceName: (await findWorkspaceName(tx, workspaceId)) ?? "" }
  })

  const delivery = await sendInviteEmail({ email: invite.email, locale, audience: "member", workspaceName })
  return { ...delivery, email: invite.email }
}

/**
 * Claims pending invitations addressed to the signed-in user's confirmed
 * e-mail — for accounts that existed before the invitation, which the sign-up
 * trigger never sees (migration 0008). Runs as the user; the function reads
 * the address from `auth.users`, never from the caller. Never fails the
 * sign-in it follows: a failed claim is retried on the next one.
 */
export async function claimPendingInvites(userId: string): Promise<void> {
  try {
    await withUser(userId, (tx) => tx.execute(sql`select public.claim_pending_invites()`))
  } catch (error) {
    logger.warn("claim pending invites failed", { error: error instanceof Error ? error.message : "unknown" })
  }
}
