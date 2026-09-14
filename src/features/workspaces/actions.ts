"use server"

import { getLocale } from "next-intl/server"

import { redirect } from "@/i18n/navigation"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireUser } from "@/server/auth/session"
import { isAppError } from "@/server/policies/errors"
import {
  createWorkspace,
  inviteMember,
  updateWorkspace,
} from "@/server/services/workspaces"

export interface FormState {
  error?: string
  fieldErrors?: Record<string, string[]>
  success?: string
}

const createSchema = z.object({
  name: z.string().min(2, "Give your workspace a name.").max(80),
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

  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors }

  let slug: string
  try {
    const workspace = await createWorkspace(user.id, parsed.data)
    slug = workspace.slug
  } catch (error) {
    return { error: isAppError(error) ? error.message : "Could not create the workspace." }
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

  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors }

  try {
    const { workspaceId, ...rest } = parsed.data
    await updateWorkspace(user.id, workspaceId, rest)
  } catch (error) {
    return { error: isAppError(error) ? error.message : "Could not save the workspace." }
  }

  revalidatePath("/", "layout")
  return { success: "Workspace updated." }
}

const inviteSchema = z.object({
  workspaceId: z.string().uuid(),
  email: z.string().email("Enter a valid e-mail address."),
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

  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors }

  try {
    await inviteMember(user.id, parsed.data.workspaceId, {
      email: parsed.data.email,
      role: parsed.data.role,
    })
  } catch (error) {
    return { error: isAppError(error) ? error.message : "Could not send the invitation." }
  }

  revalidatePath("/", "layout")
  return { success: `${parsed.data.email} will join when they sign in.` }
}
