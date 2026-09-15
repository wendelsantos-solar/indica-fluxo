"use server"

import { getLocale } from "next-intl/server"
// An external redirect (Stripe's hosted pages). `@/i18n/navigation`'s
// `redirect` would prefix a locale onto it; internal URLs below are still
// built with its `getPathname`.
import { redirect as redirectToUrl } from "next/navigation"
import { z } from "zod"

import { actionError } from "@/i18n/errors"
import { getPathname } from "@/i18n/navigation"
import { routing, type Locale } from "@/i18n/routing"
import { clientEnv } from "@/lib/env/client"
import { logger } from "@/lib/logger"
import { isAppError } from "@/server/policies/errors"
import { requireUser } from "@/server/auth/session"
import { createBillingPortalSession, createCheckoutSession } from "@/server/services/platform-billing"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export interface BillingActionState {
  error?: string
}

const PURCHASABLE = ["launch", "growth"] as const

const checkoutSchema = z.object({
  workspaceSlug: z.string().min(1),
  plan: z.enum(PURCHASABLE),
})

const portalSchema = z.object({
  workspaceSlug: z.string().min(1),
  plan: z.enum(PURCHASABLE).optional(),
})

async function currentLocale(): Promise<Locale> {
  const value = await getLocale()
  return (routing.locales as readonly string[]).includes(value) ? (value as Locale) : routing.defaultLocale
}

/**
 * Settings → "Plano e cobrança", absolute. Built from `NEXT_PUBLIC_APP_URL`,
 * never from the request's Host header.
 */
function settingsBillingUrl(locale: Locale, workspaceSlug: string, billing?: "success" | "cancelled"): string {
  const path = getPathname({
    href: {
      pathname: "/[workspaceSlug]/settings",
      params: { workspaceSlug },
      ...(billing ? { query: { billing } } : {}),
    },
    locale,
  })
  const url = new URL(path, clientEnv().NEXT_PUBLIC_APP_URL)
  url.hash = "plano"
  return url.toString()
}

function logUnexpected(action: string, error: unknown) {
  // Domain refusals are expected; anything else (Stripe down, bad price) is not.
  if (!isAppError(error)) logger.error(`${action} failed`, { error })
}

/**
 * Starts Stripe Checkout for Launch or Growth. Form fields: `workspaceSlug`,
 * `plan` (`launch` | `growth`). Redirects to Stripe on success; returns
 * `{ error }` otherwise. Use with `useActionState`.
 */
export async function startCheckoutAction(_prev: BillingActionState, formData: FormData): Promise<BillingActionState> {
  const user = await requireUser()
  const parsed = checkoutSchema.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    plan: formData.get("plan"),
  })
  if (!parsed.success) return { error: await actionError(null, "invalidRequest") }

  let url: string
  try {
    const locale = await currentLocale()
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    const session = await createCheckoutSession(user.id, workspace.id, parsed.data.plan, {
      locale,
      customerEmail: user.email,
      successUrl: settingsBillingUrl(locale, workspace.slug, "success"),
      cancelUrl: settingsBillingUrl(locale, workspace.slug, "cancelled"),
    })
    url = session.url
  } catch (error) {
    logUnexpected("start checkout", error)
    return { error: await actionError(error, "billing.checkoutFailed") }
  }

  // Outside the try: `redirect` throws by design.
  redirectToUrl(url)
}

/**
 * Opens the Stripe Billing Portal. Form fields: `workspaceSlug`, and optionally
 * `plan` (`launch` | `growth`) to open directly on confirming a plan change.
 * Redirects to Stripe on success; returns `{ error }` otherwise.
 */
export async function openBillingPortalAction(
  _prev: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const user = await requireUser()
  const parsed = portalSchema.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    plan: formData.get("plan") || undefined,
  })
  if (!parsed.success) return { error: await actionError(null, "invalidRequest") }

  let url: string
  try {
    const locale = await currentLocale()
    const workspace = await getWorkspaceForUser(user.id, parsed.data.workspaceSlug)
    const session = await createBillingPortalSession(
      user.id,
      workspace.id,
      settingsBillingUrl(locale, workspace.slug),
      parsed.data.plan ? { plan: parsed.data.plan } : undefined,
      { locale },
    )
    url = session.url
  } catch (error) {
    logUnexpected("open billing portal", error)
    return { error: await actionError(error, "billing.portalFailed") }
  }

  redirectToUrl(url)
}
