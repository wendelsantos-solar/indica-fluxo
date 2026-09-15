import type { EmailOtpType } from "@supabase/supabase-js"
import { hasLocale } from "next-intl"
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { safeRedirectPath } from "@/features/auth/safe-redirect"
import { getPathname } from "@/i18n/navigation"
import { routing } from "@/i18n/routing"
import { createClient } from "@/lib/supabase/server"
import { claimPendingInvites } from "@/server/services/workspaces"

/** The e-mail link types `verifyOtp` accepts with a `token_hash`. */
const emailOtpType = z.enum([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]) satisfies z.ZodType<EmailOtpType>

/**
 * Landing for e-mailed links (sign-up confirmation, password recovery,
 * invitations). Trades the link for a session cookie, then continues to `next`.
 *
 * Two link shapes arrive here:
 * - `?code=` — the PKCE flow, for links this app requested from the browser's
 *   session (sign-up, recovery).
 * - `?token_hash=&type=` — links issued by the Auth Admin API (invitations),
 *   which have no PKCE verifier. The Supabase "Invite user" template must
 *   point at `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=invite`.
 *
 * `next` is a query parameter on a link, so it is only followed when it is a
 * same-origin relative path; anything else opens the app instead.
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/[locale]/auth/callback">) {
  const { locale: raw } = await params
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale
  const { searchParams } = request.nextUrl

  const code = searchParams.get("code")
  const next = safeRedirectPath(
    searchParams.get("next"),
    getPathname({ href: "/app", locale }),
  )

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      if (data.user) await claimPendingInvites(data.user.id)
      return NextResponse.redirect(new URL(next, request.url))
    }
  }

  const tokenHash = searchParams.get("token_hash")
  const type = emailOtpType.safeParse(searchParams.get("type"))
  if (!code && tokenHash && type.success) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.verifyOtp({ type: type.data, token_hash: tokenHash })
    if (!error) {
      if (data.user) await claimPendingInvites(data.user.id)
      return NextResponse.redirect(new URL(next, request.url))
    }
  }

  // Expired, already used, or opened in a browser without the PKCE verifier.
  const login = new URL(getPathname({ href: "/login", locale }), request.url)
  login.searchParams.set("error", "link")
  return NextResponse.redirect(login)
}
