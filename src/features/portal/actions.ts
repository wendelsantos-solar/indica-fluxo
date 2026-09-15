"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { actionError, fieldErrorsFrom, successMessage } from "@/i18n/errors"
import { AFFILIATE_LAYOUT } from "@/lib/revalidate"
import { requireUser } from "@/server/auth/session"
import { deleteReferralLink, renameReferralLink } from "@/server/services/portal"

export interface LinkFormState {
  error?: string
  fieldErrors?: Record<string, string[]>
  success?: string
}

// Messages are catalogue keys under `errors.fields`, as in `createLinkAction`.
const renameSchema = z.object({
  linkId: z.string().uuid(),
  name: z.string("linkName").trim().min(2, "linkName").max(80, "linkNameTooLong"),
})

const deleteSchema = z.object({ linkId: z.string().uuid() })

export async function renameLinkAction(_prev: LinkFormState, formData: FormData): Promise<LinkFormState> {
  const user = await requireUser()
  const parsed = renameSchema.safeParse({ linkId: formData.get("linkId"), name: formData.get("name") })

  if (!parsed.success) {
    const { linkId, ...fieldErrors } = await fieldErrorsFrom(parsed.error)
    // A tampered hidden field is not something the reader can fix.
    if (linkId?.length) return { error: await actionError(null, "linkNotSaved") }
    return { fieldErrors }
  }

  try {
    await renameReferralLink(user.id, parsed.data.linkId, parsed.data.name)
  } catch (error) {
    return { error: await actionError(error, "linkNotSaved") }
  }

  revalidatePath(AFFILIATE_LAYOUT, "layout")
  return { success: await successMessage("linkRenamed") }
}

export async function deleteLinkAction(_prev: LinkFormState, formData: FormData): Promise<LinkFormState> {
  const user = await requireUser()
  const parsed = deleteSchema.safeParse({ linkId: formData.get("linkId") })
  if (!parsed.success) return { error: await actionError(null, "linkNotDeleted") }

  try {
    await deleteReferralLink(user.id, parsed.data.linkId)
  } catch (error) {
    return { error: await actionError(error, "linkNotDeleted") }
  }

  revalidatePath(AFFILIATE_LAYOUT, "layout")
  return { success: await successMessage("linkDeleted") }
}
