"use server"

import { actionError, successMessage } from "@/i18n/errors"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireUser } from "@/server/auth/session"
import {
  connectIntegration,
  disconnectIntegration,
} from "@/server/services/integrations"
import { rotateApiKey } from "@/server/services/api-keys"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export interface IntegrationFormState {
  error?: string
  success?: string
  /** Returned once, straight after rotation. Never persisted in plaintext. */
  revealedKey?: string
}

const connectSchema = z.object({
  workspaceSlug: z.string().min(1),
  providerAccountId: z
    .string()
    .regex(/^acct_[A-Za-z0-9]{8,}$/, "Enter a Stripe account id, e.g. acct_1A2b3C4d5E."),
})

/**
 * Manual connect path, used when Stripe Connect OAuth is not configured (local
 * development, or a founder on a single Stripe account). We store the account
 * id only — never a secret key.
 */
export async function connectStripeAction(
  _prev: IntegrationFormState,
  formData: FormData,
): Promise<IntegrationFormState> {
  const user = await requireUser()
  const parsed = connectSchema.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    providerAccountId: formData.get("providerAccountId"),
  })

  if (!parsed.success) {
    return { error: z.flattenError(parsed.error).fieldErrors.providerAccountId?.[0] }
  }

  try {
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    await connectIntegration(user.id, workspace.id, "stripe", parsed.data.providerAccountId, {
      mode: "manual",
    })
  } catch (error) {
    return { error: await actionError(error, "stripeNotConnected") }
  }

  revalidatePath(`/${parsed.data.workspaceSlug}/integrations`)
  return { success: await successMessage("stripeConnected") }
}

export async function disconnectStripeAction(
  _prev: IntegrationFormState,
  formData: FormData,
): Promise<IntegrationFormState> {
  const user = await requireUser()
  const workspaceSlug = String(formData.get("workspaceSlug"))

  try {
    const workspace = await getWorkspaceForUser(user.id, workspaceSlug)
    await disconnectIntegration(user.id, workspace.id, "stripe")
  } catch (error) {
    return { error: await actionError(error, "stripeNotDisconnected") }
  }

  revalidatePath(`/${workspaceSlug}/integrations`)
  return { success: await successMessage("stripeDisconnected") }
}

const rotateSchema = z.object({
  workspaceSlug: z.string().min(1),
  type: z.enum(["publishable", "secret"]),
})

export async function rotateKeyAction(
  _prev: IntegrationFormState,
  formData: FormData,
): Promise<IntegrationFormState> {
  const user = await requireUser()
  const parsed = rotateSchema.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    type: formData.get("type"),
  })

  if (!parsed.success) return { error: await actionError(null, "invalidRequest") }

  try {
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    const key = await rotateApiKey(user.id, workspace.id, parsed.data.type)

    revalidatePath(`/${parsed.data.workspaceSlug}/integrations`)
    return {
      success: await successMessage("keyRotated"),
      revealedKey: key.plaintext,
    }
  } catch (error) {
    return { error: await actionError(error, "keyNotRotated") }
  }
}
