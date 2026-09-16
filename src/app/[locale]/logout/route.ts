import { NextResponse, type NextRequest } from "next/server"

import { getPathname } from "@/i18n/navigation"
import { routing, type Locale } from "@/i18n/routing"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: NextRequest, { params }: RouteContext<"/[locale]/logout">) {
  const supabase = await createClient()
  await supabase.auth.signOut()

  // Straight to the localised sign-in page: `/login` would take one more hop
  // through the locale middleware.
  const { locale } = await params
  const current = (routing.locales as readonly string[]).includes(locale) ? (locale as Locale) : routing.defaultLocale
  return NextResponse.redirect(new URL(getPathname({ href: "/login", locale: current }), request.url))
}
