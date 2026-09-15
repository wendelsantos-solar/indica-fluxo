"use server"

import { actionError, successMessage } from "@/i18n/errors"
import { getLocale } from "next-intl/server"
import { revalidatePath } from "next/cache"

import { redirect } from "@/i18n/navigation"
import { z } from "zod"

import { localMonthPeriod, resolveTimeZone } from "@/lib/time-zone"
import { requireUser } from "@/server/auth/session"
import {
  cancelPayoutBatch,
  createPayoutBatch,
  markBatchPaid,
} from "@/server/services/payouts"
import { getWorkspaceForUser } from "@/server/services/workspaces"

/**
 * Route patterns, not URLs: pages live under a locale segment and a translated
 * pathname, so a literal "/acme/payouts" matches nothing.
 */
function revalidatePayoutViews() {
  revalidatePath("/[locale]/(dashboard)/[workspaceSlug]/payouts", "page")
  revalidatePath("/[locale]/(dashboard)/[workspaceSlug]/payouts/[batchId]", "page")
}

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

  let batchId: string
  try {
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    // The batch month is the workspace's current month — a batch created on
    // 31 August at 22:00 in São Paulo is August's, not UTC's September. The
    // bounds are stored as calendar dates (00:00 UTC), so every label keeps
    // rendering them, and the reference built from them, in UTC.
    const { periodStart, periodEnd } = localMonthPeriod(new Date(), resolveTimeZone(workspace.timezone))
    const batch = await createPayoutBatch(user.id, workspace.id, {
      currency: parsed.data.currency,
      participationIds: parsed.data.participationIds,
      periodStart,
      periodEnd,
    })
    batchId = batch.id
  } catch (error) {
    return { error: await actionError(error, "batchNotCreated") }
  }

  revalidatePayoutViews()

  // The next step is paying the people in the batch, so the founder lands on
  // it — export and "mark as paid" live there. `created` shows the confirmation
  // on that page. `redirect` throws, so it stays outside the try.
  return redirect({
    href: {
      pathname: "/[workspaceSlug]/payouts/[batchId]",
      params: { workspaceSlug: parsed.data.workspaceSlug, batchId },
      query: { created: "1" },
    },
    locale: await getLocale(),
  })
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
    revalidatePayoutViews()
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
    revalidatePayoutViews()
    return { success: await successMessage("batchCancelled") }
  } catch (error) {
    return { error: await actionError(error, "batchNotCancelled") }
  }
}
