"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireUser } from "@/server/auth/session"
import { isAppError } from "@/server/policies/errors"
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
  participationIds: z.array(z.string().uuid()).min(1, "Select at least one affiliate."),
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
    return { error: z.flattenError(parsed.error).fieldErrors.participationIds?.[0] ?? "Invalid selection." }
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
    return { success: `Batch ${batch.reference} created.` }
  } catch (error) {
    return { error: isAppError(error) ? error.message : "Could not create the batch." }
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

  if (!parsed.success) return { error: "Invalid request." }

  try {
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    await markBatchPaid(
      user.id,
      workspace.id,
      parsed.data.batchId,
      parsed.data.externalReference ?? null,
    )
    revalidatePath(`/${parsed.data.workspaceSlug}/payouts`)
    return { success: "Batch marked as paid." }
  } catch (error) {
    return { error: isAppError(error) ? error.message : "Could not mark the batch as paid." }
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

  if (!parsed.success) return { error: "Invalid request." }

  try {
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    await cancelPayoutBatch(user.id, workspace.id, parsed.data.batchId)
    revalidatePath(`/${parsed.data.workspaceSlug}/payouts`)
    return { success: "Batch cancelled; commissions returned to available." }
  } catch (error) {
    return { error: isAppError(error) ? error.message : "Could not cancel the batch." }
  }
}
