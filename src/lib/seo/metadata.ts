import type { Metadata } from "next"

import { routing, type Locale } from "@/i18n/routing"
import { BRAND } from "@/lib/brand"
import { absoluteSiteUrl, siteUrl } from "@/lib/site"

import type { IndexableHref } from "./pages"

/**
 * `hreflang` values. `en` rather than `en-US`: the English pages are written
 * for any English-speaking founder, not for one country.
 */
export const HREFLANG: Record<Locale, string> = { "pt-br": "pt-BR", en: "en" }

/** Open Graph wants an underscore and a territory. */
export const OG_LOCALE: Record<Locale, string> = { "pt-br": "pt_BR", en: "en_US" }

/**
 * `x-default` — who gets the page when neither language matches the reader.
 * English: a Spanish or German founder is better served by it than by
 * Portuguese.
 */
export const X_DEFAULT_LOCALE: Locale = "en"

/**
 * Whether this deployment may be indexed at all. Off unless `SITE_INDEXING=on`:
 * the product still runs on a temporary host, and letting search engines index
 * a domain that is about to change spends the little authority a new site has
 * on URLs that will redirect. Read at build time for static pages.
 */
export function indexingEnabled(): boolean {
  if (process.env.SITE_INDEXING !== "on") return false
  // Belt and braces for Vercel: a Preview or Development deployment never
  // indexes, even if `SITE_INDEXING=on` was set for "All environments".
  const vercelEnv = process.env.VERCEL_ENV
  if (vercelEnv && vercelEnv !== "production") return false
  // Nor does a temporary or local host, whatever the flag says.
  return isIndexableHost(siteUrl().hostname)
}

/** `*.vercel.app`, localhost and IPs are never canonical homes for the site. */
export function isIndexableHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === "localhost" || host.endsWith(".localhost")) return false
  if (host.endsWith(".vercel.app")) return false
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return false
  return true
}

type StaticPathname = Exclude<keyof typeof routing.pathnames, `${string}[${string}`>

/**
 * A static route's localised path (`/pricing` → `/pt-br/precos`), read straight
 * from the routing table — the same answer `getPathname` gives, without pulling
 * the navigation runtime into metadata routes, the proxy's neighbours or tests.
 */
export function localizedPath(href: StaticPathname, locale: Locale): string {
  const spelling: string | Record<Locale, string> = routing.pathnames[href]
  const path = typeof spelling === "string" ? spelling : spelling[locale]
  return path === "/" ? `/${locale}` : `/${locale}${path}`
}

/** The absolute URL of an indexable page in one locale — no query, no hash. */
export function pageUrl(href: IndexableHref, locale: Locale): string {
  return absoluteSiteUrl(localizedPath(href, locale))
}

/**
 * Self-canonical plus one alternate per locale. Every page in the registry
 * exists in both locales, so each always points at its real equivalent — never
 * at the home page, never at the other language.
 */
export function pageAlternates(href: IndexableHref, locale: Locale) {
  const languages: Record<string, string> = {}
  for (const target of routing.locales) languages[HREFLANG[target]] = pageUrl(href, target)
  languages["x-default"] = pageUrl(href, X_DEFAULT_LOCALE)
  return { canonical: pageUrl(href, locale), languages }
}

interface PageMetadataInput {
  href: IndexableHref
  locale: Locale
  /** Goes through the `%s | Brand` template unless `absoluteTitle` is set. */
  title: string
  description: string
  /** For titles that already carry the brand (the home page). */
  absoluteTitle?: boolean
  ogType?: "website" | "article"
}

/**
 * The full metadata of an indexable page: title, description, canonical,
 * hreflang, robots, Open Graph and Twitter card. The social image comes from
 * the route's `opengraph-image` file, which Next.js adds on its own.
 */
export function pageMetadata({
  href,
  locale,
  title,
  description,
  absoluteTitle = false,
  ogType = "website",
}: PageMetadataInput): Metadata {
  const alternates = pageAlternates(href, locale)
  const socialTitle = absoluteTitle ? title : `${title} | ${BRAND.name}`

  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates,
    robots: indexingEnabled() ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: {
      type: ogType,
      siteName: BRAND.name,
      title: socialTitle,
      description,
      url: alternates.canonical,
      locale: OG_LOCALE[locale],
      alternateLocale: routing.locales.filter((other) => other !== locale).map((other) => OG_LOCALE[other]),
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      ...(BRAND.social.x ? { site: `@${BRAND.social.x}` } : {}),
    },
  }
}
