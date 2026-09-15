"use server"

import { getLocale, getTranslations } from "next-intl/server"
// The `next` target is already a locale-prefixed path taken from the URL, so
// it goes through the plain redirect: next-intl's would prefix it a second
// time. Every other redirect below uses `@/i18n/navigation`.
import { redirect as redirectToPath } from "next/navigation"
import { z } from "zod"

import { getPathname, redirect } from "@/i18n/navigation"
import { fieldErrorsFrom } from "@/i18n/errors"
import { routing, type Locale } from "@/i18n/routing"
import { clientEnv } from "@/lib/env/client"
import { logger } from "@/lib/logger"
import { createClient } from "@/lib/supabase/server"
import { claimPendingInvites } from "@/server/services/workspaces"

import { classifyAuthError, type AuthErrorKind } from "./auth-errors"
import { safeRedirectPath } from "./safe-redirect"

type FieldErrors = Record<string, string[]>

export type ErrorState = { status: "error"; error?: string; fieldErrors?: FieldErrors }
type Idle = { status: "idle" }

export type SignInState = Idle | ErrorState
export type SignUpState =
  | Idle
  | ErrorState
  /** Rendered with links to sign in and reset, so it is a flag, not a string. */
  | { status: "unavailable" }
  | { status: "confirm"; email: string }
export type ResendState = Idle | ErrorState | { status: "sent" }
export type ForgotPasswordState = Idle | ErrorState | { status: "sent"; email: string }
export type ResetPasswordState = Idle | ErrorState | { status: "expired" } | { status: "done" }

const log = logger.child({ module: "auth" })

const emailSchema = z.string().trim().email("emailInvalid")
const passwordSchema = z.string().min(8, "passwordLength")

const signInSchema = z.object({
  email: emailSchema,
  // Sign-in checks presence only: a password set before a rule changed must
  // still be able to sign in, and length is not ours to reveal here.
  password: z.string().min(1, "passwordRequired"),
})

const signUpSchema = z.object({
  fullName: z.string().trim().min(2, "fullName").max(120),
  email: emailSchema,
  password: passwordSchema,
})

async function locale(): Promise<Locale> {
  const value = await getLocale()
  return (routing.locales as readonly string[]).includes(value)
    ? (value as Locale)
    : routing.defaultLocale
}

/**
 * Where e-mailed links land. Built from `NEXT_PUBLIC_APP_URL`, never from the
 * request's Host header, which a client controls. The callback is
 * locale-prefixed, and `next` is the page the session should open on.
 */
function callbackUrl(currentLocale: Locale, next: string): string {
  const url = new URL(`/${currentLocale}/auth/callback`, clientEnv().NEXT_PUBLIC_APP_URL)
  url.searchParams.set("next", next)
  return url.toString()
}

/** The one place an auth failure becomes a sentence. */
async function errorState(kind: AuthErrorKind, fallback = "generic"): Promise<ErrorState> {
  const t = await getTranslations("errors")
  const key =
    kind === "network"
      ? "authNetwork"
      : kind === "rateLimited"
        ? "authRateLimited"
        : kind === "emailNotConfirmed"
          ? "emailNotConfirmed"
          : fallback
  return { status: "error", error: t(key) }
}

async function invalid(error: z.ZodError): Promise<ErrorState> {
  return {
    status: "error",
    fieldErrors: await fieldErrorsFrom(error),
  }
}

function logFailure(action: string, error: unknown, kind: AuthErrorKind) {
  // Never the address or the password: the kind, and Supabase's code/status.
  const detail =
    error && typeof error === "object"
      ? { code: (error as { code?: unknown }).code, status: (error as { status?: unknown }).status }
      : {}
  const level = kind === "unknown" || kind === "network" ? "error" : "warn"
  log[level](`${action} failed`, { kind, ...detail })
}

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  })
  if (!parsed.success) return invalid(parsed.error)

  const current = await locale()
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    const kind = classifyAuthError(error)
    logFailure("signIn", error, kind)
    // Deliberately generic: distinguishing "no such user" from "wrong password"
    // is a user-enumeration oracle. Only failures that say nothing about the
    // account (network, rate limit) or that already required the right
    // password (unconfirmed e-mail) get their own wording in `errorState`.
    return errorState(kind, "badCredentials")
  }

  // An invitation sent to this address after the account existed.
  await claimPendingInvites(data.user.id)

  const fallback = getPathname({ href: "/app", locale: current })
  return redirectToPath(safeRedirectPath(formData.get("next"), fallback))
}

export async function signUp(_prev: SignUpState, formData: FormData): Promise<SignUpState> {
  const parsed = signUpSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
  })
  if (!parsed.success) return invalid(parsed.error)

  const current = await locale()
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: callbackUrl(current, getPathname({ href: "/app", locale: current })),
    },
  })

  if (error) {
    const kind = classifyAuthError(error)
    logFailure("signUp", error, kind)
    if (kind === "userExists") return { status: "unavailable" }
    if (kind === "weakPassword") {
      const t = await getTranslations("errors.fields")
      return { status: "error", fieldErrors: { password: [t("passwordLength")] } }
    }
    return errorState(kind)
  }

  // With e-mail confirmation on there is no session yet. Supabase also answers
  // this way for an address that already has an account, which keeps sign-up
  // from confirming who is registered.
  if (!data.session) return { status: "confirm", email: parsed.data.email }

  return redirect({ href: "/app", locale: current })
}

export async function resendConfirmation(email: string): Promise<ResendState> {
  const parsed = emailSchema.safeParse(email)
  if (!parsed.success) return errorState("unknown")

  const current = await locale()
  const supabase = await createClient()
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data,
    options: {
      emailRedirectTo: callbackUrl(current, getPathname({ href: "/app", locale: current })),
    },
  })

  if (error) {
    const kind = classifyAuthError(error)
    logFailure("resendConfirmation", error, kind)
    return errorState(kind)
  }

  return { status: "sent" }
}

export async function requestPasswordReset(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const parsed = z.object({ email: emailSchema }).safeParse({ email: formData.get("email") })
  if (!parsed.success) return invalid(parsed.error)

  const current = await locale()
  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: callbackUrl(current, getPathname({ href: "/reset-password", locale: current })),
  })

  if (error) {
    const kind = classifyAuthError(error)
    logFailure("requestPasswordReset", error, kind)
    // Only failures that are about us, not about the address, are surfaced.
    // A per-address send limit could otherwise tell a stranger that the
    // account exists, so it answers like a success.
    const aboutUs =
      kind === "network" ||
      (kind === "rateLimited" && error.code !== "over_email_send_rate_limit")
    if (aboutUs) return errorState(kind)
  }

  return { status: "sent", email: parsed.data.email }
}

export async function updatePassword(
  _prev: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const parsed = z.object({ password: passwordSchema }).safeParse({
    password: formData.get("password"),
  })
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })

  if (error) {
    const kind = classifyAuthError(error)
    logFailure("updatePassword", error, kind)
    if (kind === "sessionMissing") return { status: "expired" }
    if (kind === "samePassword" || kind === "weakPassword") {
      const t = await getTranslations("errors.fields")
      const key = kind === "samePassword" ? "samePassword" : "passwordLength"
      return { status: "error", fieldErrors: { password: [t(key)] } }
    }
    return errorState(kind, "passwordNotUpdated")
  }

  return { status: "done" }
}

export async function signOut(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return redirect({ href: "/login", locale: await locale() })
}
