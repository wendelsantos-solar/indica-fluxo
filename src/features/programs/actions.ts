"use server"

import { getLocale } from "next-intl/server"

import { redirect } from "@/i18n/navigation"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireUser } from "@/server/auth/session"
import { isAppError } from "@/server/policies/errors"
import { createProgram, updateProgram } from "@/server/services/programs"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export interface ProgramFormState {
  error?: string
  fieldErrors?: Record<string, string[]>
  success?: string
}

/**
 * The form speaks percent and dollars; the domain speaks basis points and minor
 * units. That conversion happens exactly once, here at the boundary.
 */
const schema = z
  .object({
    workspaceSlug: z.string().min(1),
    programId: z.string().uuid().optional(),
    name: z.string().min(2, "Give the program a name.").max(80),
    description: z.string().max(500).optional(),
    status: z.enum(["draft", "active", "paused", "archived"]),
    commissionType: z.enum(["percentage", "fixed"]),
    commissionAmount: z.coerce.number().positive("Commission must be greater than zero."),
    recurrence: z.enum(["lifetime", "first_only", "months"]),
    durationMonths: z.coerce.number().int().min(1).max(120).optional(),
    attributionModel: z.enum(["first_click", "last_click"]),
    attributionWindowDays: z.coerce.number().int().min(1).max(365),
    commissionHoldDays: z.coerce.number().int().min(0).max(180),
    currency: z.string().length(3),
  })
  .refine(
    (value) => value.commissionType !== "percentage" || value.commissionAmount <= 100,
    { message: "A percentage commission cannot exceed 100%.", path: ["commissionAmount"] },
  )

function toDomain(input: z.infer<typeof schema>) {
  return {
    name: input.name,
    description: input.description ?? null,
    status: input.status,
    commissionType: input.commissionType,
    commissionValue:
      input.commissionType === "percentage"
        ? Math.round(input.commissionAmount * 100) // percent → basis points
        : Math.round(input.commissionAmount * 100), // major → minor units
    commissionDurationMonths:
      input.recurrence === "lifetime"
        ? null
        : input.recurrence === "first_only"
          ? 1
          : (input.durationMonths ?? 12),
    attributionModel: input.attributionModel,
    attributionWindowDays: input.attributionWindowDays,
    commissionHoldDays: input.commissionHoldDays,
    currency: input.currency,
  }
}

function parse(formData: FormData) {
  return schema.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    programId: formData.get("programId") || undefined,
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    status: formData.get("status"),
    commissionType: formData.get("commissionType"),
    commissionAmount: formData.get("commissionAmount"),
    recurrence: formData.get("recurrence"),
    durationMonths: formData.get("durationMonths") || undefined,
    attributionModel: formData.get("attributionModel"),
    attributionWindowDays: formData.get("attributionWindowDays"),
    commissionHoldDays: formData.get("commissionHoldDays"),
    currency: formData.get("currency"),
  })
}

export async function createProgramAction(
  _prev: ProgramFormState,
  formData: FormData,
): Promise<ProgramFormState> {
  const user = await requireUser()
  const parsed = parse(formData)
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors }

  let slug: string
  try {
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    const program = await createProgram(user.id, workspace.id, toDomain(parsed.data))
    slug = program.slug
  } catch (error) {
    return { error: isAppError(error) ? error.message : "Could not create the program." }
  }

  revalidatePath(`/${parsed.data.workspaceSlug}/programs`)
  return redirect({
    href: {
      pathname: "/[workspaceSlug]/programs/[programSlug]",
      params: { workspaceSlug: parsed.data.workspaceSlug, programSlug: slug },
    },
    locale: await getLocale(),
  })
}

export async function updateProgramAction(
  _prev: ProgramFormState,
  formData: FormData,
): Promise<ProgramFormState> {
  const user = await requireUser()
  const parsed = parse(formData)
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  if (!parsed.data.programId) return { error: "Missing program reference." }

  try {
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    await updateProgram(user.id, workspace.id, parsed.data.programId, toDomain(parsed.data))
  } catch (error) {
    return { error: isAppError(error) ? error.message : "Could not save the program." }
  }

  revalidatePath(`/${parsed.data.workspaceSlug}/programs`)
  return { success: "Program saved." }
}
