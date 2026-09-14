import { NextResponse, type NextRequest } from "next/server"

import { updateSession } from "@/lib/supabase/middleware"
import { TRACKER_PATH } from "@/lib/tracking/constants"

const PUBLIC_PREFIXES = [
  "/",
  "/pricing",
  "/docs",
  "/login",
  "/signup",
  "/auth",
  TRACKER_PATH,
  "/api/track",
  "/api/identify",
  "/api/webhooks",
  "/api/health",
]

function isPublic(pathname: string): boolean {
  if (pathname === "/") return true
  return PUBLIC_PREFIXES.some((prefix) => prefix !== "/" && pathname.startsWith(prefix))
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public ingest endpoints must not pay for a session refresh on every hit.
  if (
    pathname.startsWith("/api/track") ||
    pathname.startsWith("/api/identify") ||
    pathname.startsWith("/api/webhooks") ||
    pathname.startsWith("/api/health") ||
    pathname === TRACKER_PATH
  ) {
    return NextResponse.next()
  }

  const { response, user } = await updateSession(request)

  if (!user && !isPublic(pathname)) {
    const redirectUrl = new URL("/login", request.url)
    redirectUrl.searchParams.set("next", pathname)
    return NextResponse.redirect(redirectUrl)
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/app", request.url))
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Everything except Next.js internals and static assets. Keeping images and
     * fonts out of the matcher avoids a Supabase round trip per asset.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)",
  ],
}
