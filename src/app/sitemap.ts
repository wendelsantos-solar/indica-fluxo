import type { MetadataRoute } from "next"

import { routing } from "@/i18n/routing"
import { indexingEnabled, pageAlternates } from "@/lib/seo/metadata"
import { INDEXABLE_PAGES } from "@/lib/seo/pages"

/**
 * One entry per indexable page per locale, each carrying its hreflang
 * alternates. Only the registry (src/lib/seo/pages.ts) feeds it, so a private
 * route cannot end up here. No `priority` or `changeFrequency`: Google ignores
 * both, and invented values say nothing true. `lastModified` is the content's
 * own date, not the build's.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  if (!indexingEnabled()) return []

  return INDEXABLE_PAGES.flatMap((page) =>
    routing.locales.map((locale) => {
      const { canonical, languages } = pageAlternates(page.href, locale)
      return {
        url: canonical,
        lastModified: new Date(`${page.updated}T00:00:00Z`),
        alternates: { languages },
      }
    }),
  )
}
