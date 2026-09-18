import createIntlMiddleware from "next-intl/middleware"
import { NextResponse, type NextRequest } from "next/server"

import { updateSession } from "@/lib/supabase/middleware"
import { getPathname } from "@/i18n/navigation"
import { routing, type Locale } from "@/i18n/routing"
import {
  ACQUISITION_COOKIE,
  ACQUISITION_MAX_AGE_DAYS,
  captureAcquisition,
  encodeAcquisition,
  optedOutOfMeasurement,
} from "@/lib/seo/acquisition"
import { INDEXABLE_PAGES } from "@/lib/seo/pages"
import { appUrl, siteUrl } from "@/lib/site"
import { TRACKER_PATH } from "@/lib/tracking/constants"

const intlMiddleware = createIntlMiddleware(routing)

/**
 * Canonical (un-prefixed, un-translated) paths that do not require a session.
 * Everything else does.
 *
 * `/reset-password` renders for both states (a recovery session, or an
 * expired-link notice), so it must not bounce to sign-in. `/auth/callback` is
 * where e-mailed links land *before* a session exists — gating it would send
 * every confirmation and recovery link to the login page.
 */
const PUBLIC_PATHS = new Set<string>([
  // Every indexable page (src/lib/seo/pages.ts) — registering a page there is
  // what makes it both public and indexable.
  ...INDEXABLE_PAGES.map((page) => page.href),
  // Public but NOT indexable: the public guide links here from every beta
  // payment method. It keeps the root `noindex, nofollow` and stays out of the
  // sitemap until a connector is production-ready (SEO_CONTENT_MAP.md).
  "/docs/beta",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/auth/callback",
  // Signing out without a session is a no-op that lands on sign-in. Gating it
  // sent a signed-out visitor to `/login?next=/logout`, and the next successful
  // sign-in followed that `next` straight back into a sign-out.
  "/logout",
])

/** Public ingest surfaces: no locale, no session, no cookie refresh. */
function isIngest(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname === TRACKER_PATH ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  )
}

/**
 * Strips the locale prefix and reverses the pathname translation, so the auth
 * rules below are written once against canonical paths rather than once per
 * locale. `/pt-br/entrar` and `/en/login` both resolve to `/login`.
 */
function canonicalPath(pathname: string): { locale: Locale; path: string } {
  const [, maybeLocale, ...rest] = pathname.split("/")
  const locale = (routing.locales as readonly string[]).includes(maybeLocale ?? "")
    ? (maybeLocale as Locale)
    : routing.defaultLocale

  const localised = `/${rest.join("/")}` || "/"

  for (const [canonical, translations] of Object.entries(routing.pathnames)) {
    const candidate =
      typeof translations === "string" ? translations : translations[locale]
    if (candidate === localised) return { locale, path: canonical }
  }

  // Dynamic segments (`/[workspaceSlug]/comissoes`) never match literally.
  // Compare shape instead: same depth, and every static segment equal.
  const parts = localised.split("/").filter(Boolean)
  for (const [canonical, translations] of Object.entries(routing.pathnames)) {
    const candidate =
      typeof translations === "string" ? translations : translations[locale]
    const template = candidate.split("/").filter(Boolean)
    if (template.length !== parts.length) continue
    if (template.every((seg, i) => seg.startsWith("[") || seg === parts[i])) {
      return { locale, path: canonical }
    }
  }

  return { locale, path: localised }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (isIngest(pathname)) return NextResponse.next()

  // Locale first: it may redirect (`/` → `/pt-br`) or rewrite a translated
  // path onto its canonical route. Running auth before this would gate a URL
  // that is about to change.
  const intlResponse = intlMiddleware(request)
  if (intlResponse.headers.get("location")) return intlResponse

  const { locale, path } = canonicalPath(pathname)
  if (PUBLIC_PATHS.has(path)) return rememberFirstTouch(request, intlResponse)
  // Generated social cards (`opengraph-image`) are public by definition.
  if (/\/opengraph-image(-\w+)?$/.test(pathname)) return intlResponse

  const { response, user } = await updateSession(request)

  if (!user) {
    const loginUrl = new URL(
      getPathname({ href: "/login", locale }),
      request.url,
    )
    loginUrl.searchParams.set("next", pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Carry the locale cookie and any rewrite the intl middleware decided on
  // through to the session response, which is the one actually returned.
  for (const cookie of intlResponse.cookies.getAll()) {
    response.cookies.set(cookie)
  }
  const rewrite = intlResponse.headers.get("x-middleware-rewrite")
  if (rewrite) response.headers.set("x-middleware-rewrite", rewrite)

  return response
}

/**
 * Keeps where a visitor first came from (search, campaign, referral) until they
 * create a workspace — src/lib/seo/acquisition.ts. Only on a real page load
 * (not a client-side fetch or prefetch), only if nothing is kept yet: first touch
 * wins, so later visits never overwrite the source that brought them.
 */
function rememberFirstTouch(request: NextRequest, response: NextResponse): NextResponse {
  if (request.method !== "GET") return response
  // Client navigations are fetches, not documents. Next.js strips its own RSC
  // headers before the proxy sees them, so rely on what the browser sends.
  const dest = request.headers.get("sec-fetch-dest")
  if ((dest && dest !== "document") || request.nextUrl.searchParams.has("_rsc")) return response
  if (request.cookies.has(ACQUISITION_COOKIE)) return response
  // `_acq` is the one non-essential cookie on our own site (COOKIE_AUDIT.md):
  // a browser that asks not to be measured — Global Privacy Control or Do Not
  // Track — never gets it. Nothing else depends on it.
  if (optedOutOfMeasurement(request.headers)) return response

  const acquisition = captureAcquisition({
    url: request.nextUrl,
    referrer: request.headers.get("referer"),
    locales: routing.locales,
    ownHosts: [siteUrl().hostname, appUrl().hostname],
  })
  response.cookies.set(ACQUISITION_COOKIE, encodeAcquisition(acquisition), {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: ACQUISITION_MAX_AGE_DAYS * 24 * 60 * 60,
  })
  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
}
