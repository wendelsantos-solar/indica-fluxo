"use server"

import { actionError, fieldErrorsFrom, successMessage } from "@/i18n/errors"
import { getLocale } from "next-intl/server"

import { redirect } from "@/i18n/navigation"
import { revalidatePath } from "next/cache"

import { requireUser } from "@/server/auth/session"
import { createProgram, updateProgram } from "@/server/services/programs"
import { getWorkspaceForUser } from "@/server/services/workspaces"

import { parseProgramForm, toProgramInput } from "./schema"
import { DASHBOARD_LAYOUT } from "@/lib/revalidate"

export interface ProgramFormState {
  error?: string
  fieldErrors?: Record<string, string[]>
  success?: string
}

export async function createProgramAction(
  _prev: ProgramFormState,
  formData: FormData,
): Promise<ProgramFormState> {
  const user = await requireUser()
  const parsed = parseProgramForm(formData)
  if (!parsed.success) return {
      fieldErrors: await fieldErrorsFrom(parsed.error),
    }

  let slug: string
  try {
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    // A form without the choice (onboarding) creates a test program: a new
    // workspace is on Sandbox, which has no live mode.
    const input = toProgramInput(parsed.data)
    const program = await createProgram(user.id, workspace.id, { ...input, environment: input.environment ?? "test" })
    slug = program.slug
  } catch (error) {
    return { error: await actionError(error, "programNotCreated") }
  }

  revalidatePath(DASHBOARD_LAYOUT, "layout")

  // The last onboarding step is the overview's activation checklist, not the
  // program's settings: the founder has to see what is left before a first
  // referral can land.
  if (formData.get("onboarding") === "1") {
    return redirect({
      href: {
        pathname: "/[workspaceSlug]/overview",
        params: { workspaceSlug: parsed.data.workspaceSlug },
        query: { welcome: "1" },
      },
      locale: await getLocale(),
    })
  }

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
  const parsed = parseProgramForm(formData)
  if (!parsed.success) return {
      fieldErrors: await fieldErrorsFrom(parsed.error),
    }
  if (!parsed.data.programId) return { error: await actionError(null, "missingProgram") }

  try {
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    await updateProgram(user.id, workspace.id, parsed.data.programId, toProgramInput(parsed.data))
  } catch (error) {
    return { error: await actionError(error, "programNotSaved") }
  }

  revalidatePath(DASHBOARD_LAYOUT, "layout")
  return { success: await successMessage("programSaved") }
}
