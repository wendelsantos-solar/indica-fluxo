"use server"

import { actionError, fieldErrorsFrom, successMessage, translateFieldErrors } from "@/i18n/errors"
import { getLocale, getTranslations } from "next-intl/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import type { Locale } from "@/i18n/routing"
import { requireUser } from "@/server/auth/session"
import {
  createReferralLink,
  type CustomRate,
  inviteAffiliate,
  resendAffiliateInvite,
  setCustomRate,
  setParticipationStatus,
} from "@/server/services/affiliates"
import type { InviteDelivery } from "@/server/services/invite-mail"
import { getWorkspaceForUser } from "@/server/services/workspaces"

import { AFFILIATE_LAYOUT, DASHBOARD_LAYOUT } from "@/lib/revalidate"

import { parseCustomRate } from "./custom-rate"

/** What the invite dialog shows after success: whether an e-mail went out, and the links. */
export type AffiliateInviteOutcome = InviteDelivery & { email: string; name: string }

export interface AffiliateFormState {
  error?: string
  fieldErrors?: Record<string, string[]>
  success?: string
  /** Set by the invite and resend actions. */
  invite?: AffiliateInviteOutcome
}

// Messages are catalogue keys under `errors.fields`, translated on the way out.
const inviteSchema = z
  .object({
    workspaceSlug: z.string().min(1),
    programId: z.string().uuid("programRequired"),
    name: z.string().min(2, "affiliateName").max(120, "affiliateNameLength"),
    email: z.string().email("emailInvalid"),
    companyName: z.string().max(120, "companyNameLength").optional(),
    code: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]{1,48}$/, "referralCodeFormat")
      .optional()
      .or(z.literal("")),
    customRate: z.coerce
      .number("customRateNumber")
      .min(0, "customRateRange")
      .max(100, "customRateRange")
      .optional(),
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
      fieldErrors: await fieldErrorsFrom(parsed.error),
    }

  let invite: InviteDelivery
  try {
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    const result = await inviteAffiliate(
      user.id,
      workspace.id,
      {
        programId: parsed.data.programId,
        name: parsed.data.name,
        email: parsed.data.email,
        companyName: parsed.data.companyName ?? null,
        code: parsed.data.code || null,
        customCommissionType: parsed.data.customRate !== undefined ? "percentage" : null,
        customCommissionValue:
          parsed.data.customRate !== undefined ? Math.round(parsed.data.customRate * 100) : null,
      },
      (await getLocale()) as Locale,
    )
    invite = result.invite
  } catch (error) {
    return { error: await actionError(error, "affiliateNotAdded") }
  }

  revalidateAffiliateViews()
  const t = await getTranslations("success")
  const email = parsed.data.email.trim().toLowerCase()
  return {
    success: invite.emailSent
      ? t("inviteSent", { email })
      : invite.skipped === "alreadyLinked"
        ? t("affiliateEnrolled", { name: parsed.data.name })
        : t("inviteCreated"),
    invite: { ...invite, email, name: parsed.data.name },
  }
}

const resendSchema = z.object({
  workspaceSlug: z.string().min(1),
  affiliateId: z.string().uuid(),
})

/**
 * Sends an affiliate's invitation e-mail again. Hidden fields `workspaceSlug`
 * and `affiliateId`; the result carries the links to forward either way.
 */
export async function resendAffiliateInviteAction(
  _prev: AffiliateFormState,
  formData: FormData,
): Promise<AffiliateFormState> {
  const user = await requireUser()
  const parsed = resendSchema.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    affiliateId: formData.get("affiliateId"),
  })
  if (!parsed.success) return { error: await actionError(null, "invalidRequest") }

  let invite: InviteDelivery
  let name: string
  let email: string
  try {
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    ;({ name, email, ...invite } = await resendAffiliateInvite(
      user.id,
      workspace.id,
      parsed.data.affiliateId,
      (await getLocale()) as Locale,
    ))
  } catch (error) {
    return { error: await actionError(error, "inviteNotResent") }
  }

  revalidateAffiliateViews()
  const t = await getTranslations("success")
  return {
    success: invite.emailSent ? t("inviteResent", { email }) : t("inviteNotEmailed"),
    invite: { ...invite, email, name },
  }
}

/** The route patterns that show a participation's status and rate. */
function revalidateAffiliateViews() {
  // The overview checklist, program detail and the affiliates list all read this.
  revalidatePath(DASHBOARD_LAYOUT, "layout")
}

const statusSchema = z.object({
  workspaceSlug: z.string().min(1),
  participationId: z.string().uuid(),
  status: z.enum(["approved", "rejected", "suspended"]),
})

const STATUS_SUCCESS = {
  approved: "affiliateApproved",
  rejected: "affiliateRejected",
  suspended: "affiliateSuspended",
} as const

export async function setParticipationStatusAction(
  _prev: AffiliateFormState,
  formData: FormData,
): Promise<AffiliateFormState> {
  const user = await requireUser()
  const parsed = statusSchema.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    participationId: formData.get("participationId"),
    status: formData.get("status"),
  })

  // Every field is hidden: a failure here is a tampered or stale form.
  if (!parsed.success) return { error: await actionError(null, "invalidRequest") }

  try {
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    await setParticipationStatus(user.id, workspace.id, parsed.data.participationId, parsed.data.status)
  } catch (error) {
    return { error: await actionError(error, "affiliateStatusNotUpdated") }
  }

  revalidateAffiliateViews()
  return { success: await successMessage(STATUS_SUCCESS[parsed.data.status]) }
}

const rateSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("clear"),
    workspaceSlug: z.string().min(1),
    participationId: z.string().uuid(),
  }),
  z.object({
    intent: z.literal("set"),
    workspaceSlug: z.string().min(1),
    participationId: z.string().uuid(),
    type: z.enum(["percentage", "fixed"]),
    value: z.string().max(32),
    currency: z.string().length(3),
  }),
])

/** Echoes the submitted text back, so a failed submission keeps what was typed. */
export interface CustomRateFormState extends AffiliateFormState {
  values?: { type?: string; value?: string }
}

export async function setCustomRateAction(
  _prev: CustomRateFormState,
  formData: FormData,
): Promise<CustomRateFormState> {
  const user = await requireUser()
  const text = (key: string) => {
    const value = formData.get(key)
    return typeof value === "string" ? value : undefined
  }
  const values = { type: text("type"), value: text("value") }

  const parsed = rateSchema.safeParse({
    intent: text("intent"),
    workspaceSlug: text("workspaceSlug"),
    participationId: text("participationId"),
    type: values.type,
    value: values.value ?? "",
    currency: text("currency"),
  })

  if (!parsed.success) return { error: await actionError(null, "invalidRequest"), values }

  let rate: CustomRate | null = null
  if (parsed.data.intent === "set") {
    const result = parseCustomRate(parsed.data)
    if (!result.ok) {
      return { fieldErrors: await translateFieldErrors({ value: [result.error] }), values }
    }
    rate =
      result.type === "fixed"
        ? { type: "fixed", value: result.value, currency: parsed.data.currency }
        : { type: "percentage", value: result.value }
  }

  try {
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    await setCustomRate(user.id, workspace.id, parsed.data.participationId, rate)
  } catch (error) {
    return { error: await actionError(error, "rateNotUpdated"), values }
  }

  revalidateAffiliateViews()
  return { success: await successMessage(rate ? "rateUpdated" : "rateRemoved") }
}

const linkSchema = z.object({
  participationId: z.string().uuid(),
  name: z.string("linkName").trim().min(2, "linkName").max(80, "linkNameTooLong"),
  // The tracker only ever runs on an http(s) page, so any other scheme could
  // never record a click.
  destinationUrl: z
    .string("urlRequired")
    .trim()
    .max(2048, "urlTooLong")
    .url("urlRequired")
    .refine((value) => /^https?:\/\//i.test(value), "urlRequired"),
  campaign: z.string().trim().max(80, "campaignTooLong").optional(),
})

/** Echoes the submitted text back, so a failed submission keeps what was typed. */
export interface CreateLinkFormState extends AffiliateFormState {
  values?: { name?: string; destinationUrl?: string; campaign?: string }
}

/** `referral_links_participation_code_key`: the code is the slugified name. */
function isDuplicateLinkCode(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 3; depth += 1) {
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown }
    if (candidate.code === "23505") {
      return (
        candidate.constraint_name === undefined ||
        candidate.constraint_name === "referral_links_participation_code_key"
      )
    }
    current = candidate.cause
  }
  return false
}

export async function createLinkAction(
  _prev: CreateLinkFormState,
  formData: FormData,
): Promise<CreateLinkFormState> {
  const user = await requireUser()
  const text = (key: string) => {
    const value = formData.get(key)
    return typeof value === "string" ? value : undefined
  }
  const values = {
    name: text("name"),
    destinationUrl: text("destinationUrl"),
    campaign: text("campaign"),
  }

  const parsed = linkSchema.safeParse({
    participationId: text("participationId"),
    name: values.name,
    destinationUrl: values.destinationUrl,
    campaign: values.campaign?.trim() || undefined,
  })

  if (!parsed.success) {
    const { participationId, ...fieldErrors } = await fieldErrorsFrom(parsed.error)
    // A tampered or missing hidden field is not something the reader can fix.
    if (participationId?.length) {
      return { error: await actionError(null, "linkNotCreated"), values }
    }
    return { fieldErrors, values }
  }

  try {
    await createReferralLink(user.id, parsed.data.participationId, {
      name: parsed.data.name,
      destinationUrl: parsed.data.destinationUrl,
      campaign: parsed.data.campaign ?? null,
    })
  } catch (error) {
    if (isDuplicateLinkCode(error)) {
      return { fieldErrors: await translateFieldErrors({ name: ["linkNameTaken"] }), values }
    }
    return { error: await actionError(error, "linkNotCreated"), values }
  }

  // The route pattern, not a URL: pages live under a locale segment and a
  // translated pathname, so a literal "/affiliate/links" matches nothing.
  revalidatePath(AFFILIATE_LAYOUT, "layout")
  return { success: await successMessage("linkCreated") }
}
