import type { MetadataRoute } from "next"

import { routing } from "@/i18n/routing"
import { indexingEnabled, localizedPath } from "@/lib/seo/metadata"
import { absoluteSiteUrl } from "@/lib/site"

/**
 * Crawl rules. `Disallow` saves crawl budget on surfaces that have nothing to
 * index; it is not the privacy boundary. Private pages carry `noindex` (root
 * layout) and sit behind authentication (src/proxy.ts) — a disallowed URL can
 * still be indexed from links if it were not also `noindex`.
 *
 * Localised private prefixes are not listed: workspace URLs are tenant slugs
 * (`/pt-br/<slug>/…`) that no pattern can enumerate, and they redirect an
 * anonymous crawler to sign-in, whose page is `noindex`.
 *
 * With indexing off (every deploy until `SITE_INDEXING=on`), everything is
 * disallowed and there is no sitemap to advertise.
 */
export default function robots(): MetadataRoute.Robots {
  if (!indexingEnabled()) {
    return { rules: { userAgent: "*", disallow: "/" } }
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/t.js",
        ...routing.locales.flatMap((locale) => [
          localizedPath("/app", locale),
          `${localizedPath("/affiliate", locale)}/`,
        ]),
      ],
    },
    sitemap: absoluteSiteUrl("/sitemap.xml"),
  }
}
