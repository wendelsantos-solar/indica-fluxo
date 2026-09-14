import { z } from "zod"

import { majorToMinor } from "@/lib/money"

import { DURATION_MONTHS_MAX, DURATION_MONTHS_MIN, WEBSITE_URL_MAX_LENGTH } from "./limits"

/**
 * The program form's boundary: parsing and the one conversion from what the
 * form speaks (percent, major units, "months") to what the domain speaks
 * (basis points, minor units, `commission_duration_months`). Kept apart from
 * `actions.ts` because a `"use server"` module may only export actions, and
 * these rules are worth testing without a request.
 *
 * Messages are catalogue keys under `errors.fields`, translated by the action.
 */

const websiteUrl = z
  .string()
  .trim()
  .max(WEBSITE_URL_MAX_LENGTH, "websiteUrlTooLong")
  // The tracker only runs on an http(s) page; any other scheme records nothing.
  .refine(isHttpUrl, "websiteUrlInvalid")

function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false
  try {
    return Boolean(new URL(value).hostname)
  } catch {
    return false
  }
}

export const programFormSchema = z
  .object({
    workspaceSlug: z.string().min(1),
    programId: z.string().uuid().optional(),
    name: z.string().min(2, "programName").max(80),
    description: z.string().max(500).optional(),
    /** `undefined`: the field was not on the form, keep what is stored. `null`: clear it. */
    websiteUrl: websiteUrl.nullable().optional(),
    status: z.enum(["draft", "active", "paused", "archived"]),
    commissionType: z.enum(["percentage", "fixed"]),
    commissionAmount: z.coerce.number().positive("commissionPositive"),
    recurrence: z.enum(["lifetime", "first_only", "months"]),
    durationMonths: z.coerce
      .number("durationMonthsRange")
      .int("durationMonthsRange")
      .min(DURATION_MONTHS_MIN, "durationMonthsRange")
      .max(DURATION_MONTHS_MAX, "durationMonthsRange")
      .optional(),
    attributionModel: z.enum(["first_click", "last_click"]),
    attributionWindowDays: z.coerce.number().int().min(1).max(365),
    commissionHoldDays: z.coerce.number().int().min(0).max(180),
    currency: z.string().length(3),
  })
  .superRefine((value, ctx) => {
    if (value.commissionType === "percentage" && value.commissionAmount > 100) {
      ctx.addIssue({ code: "custom", message: "percentageOver100", path: ["commissionAmount"] })
    }
    if (value.recurrence === "months" && value.durationMonths === undefined) {
      ctx.addIssue({ code: "custom", message: "durationMonthsRange", path: ["durationMonths"] })
    }
  })

export type ProgramFormInput = z.infer<typeof programFormSchema>

function text(formData: FormData, key: string): string | undefined {
  const value = formData.get(key)
  return typeof value === "string" && value !== "" ? value : undefined
}

export function parseProgramForm(formData: FormData) {
  const website = formData.get("websiteUrl")
  return programFormSchema.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    programId: text(formData, "programId"),
    name: formData.get("name"),
    description: text(formData, "description"),
    websiteUrl: typeof website === "string" ? website.trim() || null : undefined,
    status: formData.get("status"),
    commissionType: formData.get("commissionType"),
    commissionAmount: formData.get("commissionAmount"),
    recurrence: formData.get("recurrence"),
    // Only meaningful for "months"; a stale value under another choice is ignored.
    durationMonths:
      formData.get("recurrence") === "months" ? text(formData, "durationMonths") : undefined,
    attributionModel: formData.get("attributionModel"),
    attributionWindowDays: formData.get("attributionWindowDays"),
    commissionHoldDays: formData.get("commissionHoldDays"),
    currency: formData.get("currency"),
  })
}

export function toProgramInput(input: ProgramFormInput) {
  return {
    name: input.name,
    description: input.description ?? null,
    websiteUrl: input.websiteUrl,
    status: input.status,
    commissionType: input.commissionType,
    // Percent → basis points (× 100); a fixed amount → minor units of the
    // program's currency (× 100 for cents, × 1 for JPY and other zero-decimal
    // currencies).
    commissionValue:
      input.commissionType === "percentage"
        ? Math.round(input.commissionAmount * 100)
        : majorToMinor(input.commissionAmount, input.currency),
    commissionDurationMonths:
      input.recurrence === "lifetime"
        ? null
        : input.recurrence === "first_only"
          ? 1
          : (input.durationMonths ?? null),
    attributionModel: input.attributionModel,
    attributionWindowDays: input.attributionWindowDays,
    commissionHoldDays: input.commissionHoldDays,
    currency: input.currency,
  }
}
