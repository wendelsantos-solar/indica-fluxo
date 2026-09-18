/**
 * The indexable surface of the site — the one list the sitemap, the proxy's
 * public-route set, the metadata helper and the SEO tests all read.
 *
 * A page is indexable only if it is here. Everything else inherits the root
 * layout's `noindex` (src/app/[locale]/layout.tsx), so a new private route is
 * safe by default and a new public page is invisible until it is registered.
 *
 * Each entry is one search intent served in both locales; the localised slugs
 * live in `src/i18n/routing.ts`. The editorial side of every entry — keywords,
 * titles, links, status — is SEO_CONTENT_MAP.md.
 */

/** What the searcher wants. Commercial and transactional intents come first (SEO_STRATEGY.md §4). */
export type SearchIntent = "informational" | "commercial" | "transactional" | "comparison"

export type SeoCluster = "product" | "affiliate-program" | "stripe" | "integration" | "alternatives" | "legal"

export interface IndexablePage {
  /** Canonical pathname, as `Link` takes it. */
  href: string
  intent: SearchIntent
  cluster: SeoCluster
  /**
   * The day the page's content last materially changed (`YYYY-MM-DD`), which
   * becomes the sitemap's `lastModified`. Hand-kept and honest: bump it when the
   * copy changes, never on a deploy.
   */
  updated: string
  /**
   * Required for `comparison` pages: the day a competitor's price, features and
   * limits were last checked against their own public pages. A test fails once
   * it is older than `COMPARISON_MAX_AGE_DAYS`, because a stale comparison is a
   * false claim about someone else's product.
   */
  verifiedOn?: string
}

export const INDEXABLE_PAGES = [
  { href: "/", intent: "commercial", cluster: "product", updated: "2026-09-18" },
  { href: "/pricing", intent: "transactional", cluster: "product", updated: "2026-09-18" },
  { href: "/docs", intent: "informational", cluster: "integration", updated: "2026-09-18" },
  { href: "/saas-affiliate-program", intent: "commercial", cluster: "affiliate-program", updated: "2026-09-18" },
  { href: "/affiliate-software", intent: "commercial", cluster: "affiliate-program", updated: "2026-09-18" },
  { href: "/stripe-affiliates", intent: "commercial", cluster: "stripe", updated: "2026-09-18" },
  // Trust pages: indexable so they can be found and cited, never optimised for
  // commercial keywords (brief §22).
  { href: "/terms", intent: "informational", cluster: "legal", updated: "2026-09-18" },
  { href: "/privacy", intent: "informational", cluster: "legal", updated: "2026-09-18" },
  { href: "/cookies", intent: "informational", cluster: "legal", updated: "2026-09-18" },
] as const satisfies readonly IndexablePage[]

export type IndexableHref = (typeof INDEXABLE_PAGES)[number]["href"]

export const COMPARISON_MAX_AGE_DAYS = 120

export function isIndexableHref(href: string): href is IndexableHref {
  return INDEXABLE_PAGES.some((page) => page.href === href)
}
