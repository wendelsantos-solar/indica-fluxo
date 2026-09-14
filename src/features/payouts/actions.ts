"use server"

import { actionError, successMessage } from "@/i18n/errors"
import { getTranslations } from "next-intl/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireUser } from "@/server/auth/session"
import {
  cancelPayoutBatch,
  createPayoutBatch,
  markBatchPaid,
} from "@/server/services/payouts"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export interface PayoutFormState {
  error?: string
  success?: string
}

const createSchema = z.object({
  workspaceSlug: z.string().min(1),
  currency: z.string().length(3),
  participationIds: z.array(z.string().uuid()).min(1, "selectAffiliate"),
})

export async function createPayoutBatchAction(
  _prev: PayoutFormState,
  formData: FormData,
): Promise<PayoutFormState> {
  const user = await requireUser()

  const parsed = createSchema.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    currency: formData.get("currency"),
    participationIds: formData.getAll("participationIds").map(String),
  })

  if (!parsed.success) {
    // An empty selection is the one mistake a founder can make here; anything
    // else means the form was tampered with.
    const emptySelection = Boolean(z.flattenError(parsed.error).fieldErrors.participationIds)
    return { error: await actionError(null, emptySelection ? "selectAffiliate" : "invalidRequest") }
  }

  const now = new Date()
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))

  try {
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    const batch = await createPayoutBatch(user.id, workspace.id, {
      currency: parsed.data.currency,
      participationIds: parsed.data.participationIds,
      periodStart,
      periodEnd,
    })

    revalidatePath(`/${parsed.data.workspaceSlug}/payouts`)
    const t = await getTranslations("success")
    return { success: t("batchCreated", { reference: batch.reference }) }
  } catch (error) {
    return { error: await actionError(error, "batchNotCreated") }
  }
}

const batchSchema = z.object({
  workspaceSlug: z.string().min(1),
  batchId: z.string().uuid(),
  externalReference: z.string().max(120).optional(),
})

export async function markBatchPaidAction(
  _prev: PayoutFormState,
  formData: FormData,
): Promise<PayoutFormState> {
  const user = await requireUser()
  const parsed = batchSchema.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    batchId: formData.get("batchId"),
    externalReference: formData.get("externalReference") || undefined,
  })

  if (!parsed.success) return { error: await actionError(null, "invalidRequest") }

  try {
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    await markBatchPaid(
      user.id,
      workspace.id,
      parsed.data.batchId,
      parsed.data.externalReference ?? null,
    )
    revalidatePath(`/${parsed.data.workspaceSlug}/payouts`)
    return { success: await successMessage("batchPaid") }
  } catch (error) {
    return { error: await actionError(error, "batchNotPaid") }
  }
}

export async function cancelBatchAction(
  _prev: PayoutFormState,
  formData: FormData,
): Promise<PayoutFormState> {
  const user = await requireUser()
  const parsed = batchSchema.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    batchId: formData.get("batchId"),
  })

  if (!parsed.success) return { error: await actionError(null, "invalidRequest") }

  try {
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    await cancelPayoutBatch(user.id, workspace.id, parsed.data.batchId)
    revalidatePath(`/${parsed.data.workspaceSlug}/payouts`)
    return { success: await successMessage("batchCancelled") }
  } catch (error) {
    return { error: await actionError(error, "batchNotCancelled") }
  }
}
