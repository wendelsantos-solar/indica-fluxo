import { hasLocale } from "next-intl"
import { NextResponse, type NextRequest } from "next/server"

import { safeRedirectPath } from "@/features/auth/safe-redirect"
import { getPathname } from "@/i18n/navigation"
import { routing } from "@/i18n/routing"
import { createClient } from "@/lib/supabase/server"

/**
 * Landing for e-mailed links (sign-up confirmation, password recovery).
 * Exchanges the one-time code for a session cookie, then continues to `next`.
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
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(new URL(next, request.url))
  }

  // Expired, already used, or opened in a browser without the PKCE verifier.
  const login = new URL(getPathname({ href: "/login", locale }), request.url)
  login.searchParams.set("error", "link")
  return NextResponse.redirect(login)
}
