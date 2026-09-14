"use server"

import { actionError, successMessage, translateFieldErrors } from "@/i18n/errors"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireUser } from "@/server/auth/session"
import {
  createReferralLink,
  inviteAffiliate,
  setCustomRate,
  setParticipationStatus,
} from "@/server/services/affiliates"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export interface AffiliateFormState {
  error?: string
  fieldErrors?: Record<string, string[]>
  success?: string
}

const inviteSchema = z
  .object({
    workspaceSlug: z.string().min(1),
    programId: z.string().uuid("Choose a program."),
    name: z.string().min(2, "affiliateName").max(120),
    email: z.string().email("emailInvalid"),
    companyName: z.string().max(120).optional(),
    code: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]{1,48}$/, "Use lowercase letters, numbers, - or _.")
      .optional()
      .or(z.literal("")),
    customRate: z.coerce.number().min(0).max(100).optional(),
  })
  .refine((value) => value.customRate === undefined || value.customRate > 0, {
    message: "customRatePositive",
    path: ["customRate"],
  })

export async function inviteAffiliateAction(
  _prev: AffiliateFormState,
  formData: FormData,
): Promise<AffiliateFormState> {
  const user = await requireUser()

  const rawRate = formData.get("customRate")
  const parsed = inviteSchema.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    programId: formData.get("programId"),
    name: formData.get("name"),
    email: formData.get("email"),
    companyName: formData.get("companyName") || undefined,
    code: formData.get("code") || undefined,
    customRate: rawRate && String(rawRate).trim() !== "" ? rawRate : undefined,
  })

  if (!parsed.success) return {
      fieldErrors: await translateFieldErrors(z.flattenError(parsed.error).fieldErrors),
    }

  try {
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    await inviteAffiliate(user.id, workspace.id, {
      programId: parsed.data.programId,
      name: parsed.data.name,
      email: parsed.data.email,
      companyName: parsed.data.companyName ?? null,
      code: parsed.data.code || null,
      customCommissionType: parsed.data.customRate !== undefined ? "percentage" : null,
      customCommissionValue:
        parsed.data.customRate !== undefined ? Math.round(parsed.data.customRate * 100) : null,
    })
  } catch (error) {
    return { error: await actionError(error, "affiliateNotAdded") }
  }

  revalidatePath(`/${parsed.data.workspaceSlug}/affiliates`)
  return { success: `${parsed.data.name} was added to the program.` }
}

const statusSchema = z.object({
  workspaceSlug: z.string().min(1),
  participationId: z.string().uuid(),
  status: z.enum(["approved", "rejected", "suspended"]),
})

export async function setParticipationStatusAction(formData: FormData): Promise<void> {
  const user = await requireUser()
  const parsed = statusSchema.parse({
    workspaceSlug: formData.get("workspaceSlug"),
    participationId: formData.get("participationId"),
    status: formData.get("status"),
  })

  const workspace = await getWorkspaceForUser(user.id, parsed.workspaceSlug)
  await setParticipationStatus(user.id, workspace.id, parsed.participationId, parsed.status)
  revalidatePath(`/${parsed.workspaceSlug}/affiliates`)
}

const rateSchema = z.object({
  workspaceSlug: z.string().min(1),
  participationId: z.string().uuid(),
  rate: z.coerce.number().min(0).max(100),
})

export async function setCustomRateAction(
  _prev: AffiliateFormState,
  formData: FormData,
): Promise<AffiliateFormState> {
  const user = await requireUser()
  const parsed = rateSchema.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    participationId: formData.get("participationId"),
    rate: formData.get("rate"),
  })

  if (!parsed.success) return {
      fieldErrors: await translateFieldErrors(z.flattenError(parsed.error).fieldErrors),
    }

  try {
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    await setCustomRate(
      user.id,
      workspace.id,
      parsed.data.participationId,
      parsed.data.rate > 0
        ? { type: "percentage", value: Math.round(parsed.data.rate * 100) }
        : null,
    )
  } catch (error) {
    return { error: await actionError(error, "rateNotUpdated") }
  }

  revalidatePath(`/${parsed.data.workspaceSlug}/affiliates`)
  return { success: await successMessage("rateUpdated") }
}

const linkSchema = z.object({
  participationId: z.string().uuid(),
  name: z.string().min(2, "linkName").max(80),
  destinationUrl: z.string().url("urlRequired"),
  campaign: z.string().max(80).optional(),
})

export async function createLinkAction(
  _prev: AffiliateFormState,
  formData: FormData,
): Promise<AffiliateFormState> {
  const user = await requireUser()
  const parsed = linkSchema.safeParse({
    participationId: formData.get("participationId"),
    name: formData.get("name"),
    destinationUrl: formData.get("destinationUrl"),
    campaign: formData.get("campaign") || undefined,
  })

  if (!parsed.success) return {
      fieldErrors: await translateFieldErrors(z.flattenError(parsed.error).fieldErrors),
    }

  try {
    await createReferralLink(user.id, parsed.data.participationId, {
      name: parsed.data.name,
      destinationUrl: parsed.data.destinationUrl,
      campaign: parsed.data.campaign ?? null,
    })
  } catch (error) {
    return { error: await actionError(error, "linkNotCreated") }
  }

  revalidatePath("/affiliate/links")
  return { success: await successMessage("linkCreated") }
}
