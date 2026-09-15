"use server"

import { actionError, fieldErrorsFrom, successMessage } from "@/i18n/errors"
import { getLocale, getTranslations } from "next-intl/server"

import { redirect } from "@/i18n/navigation"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import type { Locale } from "@/i18n/routing"
import { requireUser } from "@/server/auth/session"
import type { InviteDelivery } from "@/server/services/invite-mail"
import {
  changeMemberRole,
  createWorkspace,
  inviteMember,
  removeMember,
  resendMemberInvite,
  revokeInvite,
  updateWorkspace,
} from "@/server/services/workspaces"
import { DASHBOARD_LAYOUT } from "@/lib/revalidate"

/** What an invite form shows after success: whether an e-mail went out, and the links. */
export type InviteOutcome = InviteDelivery & { email: string }

export interface FormState {
  error?: string
  fieldErrors?: Record<string, string[]>
  success?: string
  invite?: InviteOutcome
}

const createSchema = z.object({
  name: z.string().min(2, "workspaceName").max(80),
  defaultCurrency: z.string().length(3),
  timezone: z.string().min(1).max(64),
})

export async function createWorkspaceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser()

  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    defaultCurrency: formData.get("defaultCurrency") ?? "USD",
    timezone: formData.get("timezone") ?? "UTC",
  })

  if (!parsed.success) return {
      fieldErrors: await fieldErrorsFrom(parsed.error),
    }

  let slug: string
  try {
    const workspace = await createWorkspace(user.id, parsed.data)
    slug = workspace.slug
  } catch (error) {
    return { error: await actionError(error, "workspaceNotCreated") }
  }

  return redirect({
    href: {
      pathname: "/[workspaceSlug]/programs/new",
      params: { workspaceSlug: slug },
      query: { onboarding: "1" },
    },
    locale: await getLocale(),
  })
}

const updateSchema = createSchema.extend({ workspaceId: z.string().uuid() })

export async function updateWorkspaceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser()

  const parsed = updateSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    name: formData.get("name"),
    defaultCurrency: formData.get("defaultCurrency"),
    timezone: formData.get("timezone"),
  })

  if (!parsed.success) return {
      fieldErrors: await fieldErrorsFrom(parsed.error),
    }

  try {
    const { workspaceId, ...rest } = parsed.data
    await updateWorkspace(user.id, workspaceId, rest)
  } catch (error) {
    return { error: await actionError(error, "workspaceNotSaved") }
  }

  revalidatePath(DASHBOARD_LAYOUT, "layout")
  return { success: await successMessage("workspaceUpdated") }
}

const inviteSchema = z.object({
  workspaceId: z.string().uuid(),
  email: z.string().email("emailInvalid"),
  role: z.enum(["admin", "member"]),
})

export async function inviteMemberAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser()

  const parsed = inviteSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    email: formData.get("email"),
    role: formData.get("role") ?? "member",
  })

  if (!parsed.success) return {
      fieldErrors: await fieldErrorsFrom(parsed.error),
    }

  let invite: InviteOutcome
  try {
    invite = await inviteMember(
      user.id,
      parsed.data.workspaceId,
      { email: parsed.data.email, role: parsed.data.role },
      (await getLocale()) as Locale,
    )
  } catch (error) {
    return { error: await actionError(error, "inviteNotSent") }
  }

  revalidatePath(DASHBOARD_LAYOUT, "layout")
  const t = await getTranslations("success")
  return {
    success: invite.emailSent ? t("inviteSent", { email: invite.email }) : t("inviteCreated"),
    invite,
  }
}

const memberSchema = z.object({
  workspaceId: z.string().uuid(),
  memberId: z.string().uuid(),
})

const roleSchema = memberSchema.extend({ role: z.enum(["admin", "member"]) })

export async function changeMemberRoleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser()
  const parsed = roleSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    memberId: formData.get("memberId"),
    role: formData.get("role"),
  })
  // Every field is a hidden input or a fixed choice: a failure is a stale form.
  if (!parsed.success) return { error: await actionError(null, "invalidRequest") }

  try {
    await changeMemberRole(user.id, parsed.data.workspaceId, parsed.data.memberId, parsed.data.role)
  } catch (error) {
    return { error: await actionError(error, "memberNotUpdated") }
  }

  // An admin who made themselves a member can no longer manage the team; the
  // revalidated page renders read-only.
  revalidatePath(DASHBOARD_LAYOUT, "layout")
  return { success: await successMessage("memberRoleChanged") }
}

export async function removeMemberAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser()
  const parsed = memberSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    memberId: formData.get("memberId"),
  })
  if (!parsed.success) return { error: await actionError(null, "invalidRequest") }

  let self: boolean
  try {
    ;({ self } = await removeMember(user.id, parsed.data.workspaceId, parsed.data.memberId))
  } catch (error) {
    return { error: await actionError(error, "memberNotRemoved") }
  }

  revalidatePath(DASHBOARD_LAYOUT, "layout")
  // Leaving a workspace takes its pages away; the post-login fork picks
  // another workspace, the portal, or onboarding.
  if (self) return redirect({ href: "/app", locale: await getLocale() })
  return { success: await successMessage("memberRemoved") }
}

const inviteIdSchema = z.object({
  workspaceId: z.string().uuid(),
  inviteId: z.string().uuid(),
})

export async function revokeInviteAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser()
  const parsed = inviteIdSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    inviteId: formData.get("inviteId"),
  })
  if (!parsed.success) return { error: await actionError(null, "invalidRequest") }

  try {
    await revokeInvite(user.id, parsed.data.workspaceId, parsed.data.inviteId)
  } catch (error) {
    return { error: await actionError(error, "inviteNotRevoked") }
  }

  revalidatePath(DASHBOARD_LAYOUT, "layout")
  return { success: await successMessage("inviteRevoked") }
}

export async function resendMemberInviteAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser()
  const parsed = inviteIdSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    inviteId: formData.get("inviteId"),
  })
  if (!parsed.success) return { error: await actionError(null, "invalidRequest") }

  let invite: InviteOutcome
  try {
    invite = await resendMemberInvite(
      user.id,
      parsed.data.workspaceId,
      parsed.data.inviteId,
      (await getLocale()) as Locale,
    )
  } catch (error) {
    return { error: await actionError(error, "inviteNotResent") }
  }

  // A delivered invitation creates the account, which claims the invite: the
  // row moves from "pending" to the member list.
  revalidatePath(DASHBOARD_LAYOUT, "layout")
  const t = await getTranslations("success")
  return {
    success: invite.emailSent ? t("inviteResent", { email: invite.email }) : t("inviteNotEmailed"),
    invite,
  }
}
