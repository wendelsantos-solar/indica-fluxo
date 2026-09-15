"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { actionError, successMessage } from "@/i18n/errors"
import { majorToMinor } from "@/lib/money"
import { DASHBOARD_LAYOUT } from "@/lib/revalidate"
import { requireUser } from "@/server/auth/session"
import {
  simulateTestConversion,
  simulateTestRefund,
  simulateTestRenewal,
  type SimulationResult,
} from "@/server/services/sandbox"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export interface SimulationFormState {
  error?: string
  success?: string
  /** Which simulation produced `result`. */
  kind?: "conversion" | "renewal" | "refund"
  result?: SimulationResult
}

/** "49,90" or "49.90" → 49.9. Thousands separators are not accepted: the field is a plain amount. */
const majorAmount = z
  .string()
  .trim()
  .regex(/^\d{1,9}([.,]\d{1,2})?$/, "sandboxAmountInvalid")
  .transform((value) => Number(value.replace(",", ".")))
  .refine((value) => value > 0, "sandboxAmountInvalid")

const base = {
  workspaceSlug: z.string().min(1),
  simulationId: z.uuid(),
  currency: z.string().regex(/^[A-Z]{3}$/),
}

const conversionSchema = z.object({
  ...base,
  programId: z.uuid(),
  participationId: z.uuid(),
  amount: majorAmount,
  externalId: z
    .string()
    .trim()
    .max(120)
    .regex(/^[A-Za-z0-9_.:@-]*$/, "sandboxExternalIdInvalid")
    .optional(),
})

const followUpSchema = z.object({
  ...base,
  customerExternalId: z.string().trim().min(1).max(200),
  amount: majorAmount.optional(),
})

function fields(formData: FormData, names: string[]) {
  return Object.fromEntries(
    names.map((name) => {
      const value = formData.get(name)
      return [name, typeof value === "string" && value !== "" ? value : undefined]
    }),
  )
}

async function invalid(error: z.ZodError): Promise<SimulationFormState> {
  const keys = new Set(error.issues.map((issue) => issue.message))
  const key = keys.has("sandboxAmountInvalid")
    ? "sandboxAmountInvalid"
    : keys.has("sandboxExternalIdInvalid")
      ? "sandboxExternalIdInvalid"
      : "invalidRequest"
  return { error: await actionError(null, key) }
}

/**
 * Simulates a click, an identify and a payment on a TEST program, through the
 * real services. The amount arrives in major units and becomes minor units of
 * the program's currency here, once.
 */
export async function simulateConversionAction(
  _prev: SimulationFormState,
  formData: FormData,
): Promise<SimulationFormState> {
  const user = await requireUser()
  const parsed = conversionSchema.safeParse(
    fields(formData, ["workspaceSlug", "simulationId", "currency", "programId", "participationId", "amount", "externalId"]),
  )
  if (!parsed.success) return invalid(parsed.error)
  const input = parsed.data

  try {
    const workspace = await getWorkspaceForUser(user.id, input.workspaceSlug)
    const result = await simulateTestConversion(user.id, workspace.id, {
      programId: input.programId,
      participationId: input.participationId,
      amountMinor: majorToMinor(input.amount, input.currency),
      externalId: input.externalId || null,
      simulationId: input.simulationId,
    })
    revalidatePath(DASHBOARD_LAYOUT, "layout")
    return { kind: "conversion", result, success: await successMessage("sandboxConversionSimulated") }
  } catch (error) {
    return { error: await actionError(error, "sandboxNotSimulated") }
  }
}

/** A second payment by the simulated customer: a recurring commission, if the program pays renewals. */
export async function simulateRenewalAction(
  _prev: SimulationFormState,
  formData: FormData,
): Promise<SimulationFormState> {
  const user = await requireUser()
  const parsed = followUpSchema.safeParse(
    fields(formData, ["workspaceSlug", "simulationId", "currency", "customerExternalId", "amount"]),
  )
  if (!parsed.success || parsed.data.amount === undefined) {
    return parsed.success ? { error: await actionError(null, "sandboxAmountInvalid") } : invalid(parsed.error)
  }
  const input = parsed.data

  try {
    const workspace = await getWorkspaceForUser(user.id, input.workspaceSlug)
    const result = await simulateTestRenewal(user.id, workspace.id, {
      customerExternalId: input.customerExternalId,
      amountMinor: majorToMinor(input.amount!, input.currency),
      simulationId: input.simulationId,
    })
    revalidatePath(DASHBOARD_LAYOUT, "layout")
    return { kind: "renewal", result, success: await successMessage("sandboxRenewalSimulated") }
  } catch (error) {
    return { error: await actionError(error, "sandboxNotSimulated") }
  }
}

/** Refunds the simulated customer's latest payment in full: the commission is reversed, never deleted. */
export async function simulateRefundAction(
  _prev: SimulationFormState,
  formData: FormData,
): Promise<SimulationFormState> {
  const user = await requireUser()
  const parsed = followUpSchema.safeParse(
    fields(formData, ["workspaceSlug", "simulationId", "currency", "customerExternalId", "amount"]),
  )
  if (!parsed.success) return invalid(parsed.error)
  const input = parsed.data

  try {
    const workspace = await getWorkspaceForUser(user.id, input.workspaceSlug)
    const result = await simulateTestRefund(user.id, workspace.id, {
      customerExternalId: input.customerExternalId,
      amountMinor: input.amount === undefined ? null : majorToMinor(input.amount, input.currency),
      simulationId: input.simulationId,
    })
    revalidatePath(DASHBOARD_LAYOUT, "layout")
    return { kind: "refund", result, success: await successMessage("sandboxRefundSimulated") }
  } catch (error) {
    return { error: await actionError(error, "sandboxNotSimulated") }
  }
}
