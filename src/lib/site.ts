import { clientEnv } from "@/lib/env/client"

/**
 * The two public origins.
 *
 * - `appUrl()` — where the product runs: the dashboard, `/api/*`, `/t.js`, OAuth
 *   and e-mail redirects. Snippets founders paste into their own code use it.
 * - `siteUrl()` — the public, indexable website: canonical URLs, `hreflang`,
 *   the sitemap, OpenGraph. `NEXT_PUBLIC_SITE_URL`, falling back to the app
 *   origin while both live on one host (today they do).
 *
 * Neither is ever hardcoded: the final domain is not decided, and switching it
 * must be one environment change (SEO_DEPLOY_CHECKLIST.md).
 *
 * `next build` collects metadata without a configured environment, so an
 * invalid or missing value falls back to the dev origin instead of failing the
 * build; `clientEnv()` still rejects a bad value at runtime everywhere else.
 */
export function appUrl(): URL {
  try {
    return new URL(clientEnv().NEXT_PUBLIC_APP_URL)
  } catch {
    return new URL("http://localhost:3000")
  }
}

export function siteUrl(): URL {
  const configured = process.env.NEXT_PUBLIC_SITE_URL
  if (configured) {
    try {
      return new URL(configured)
    } catch {
      // An unparseable value is a deploy mistake; fall through to the app origin
      // rather than emit canonical URLs on a malformed host.
    }
  }
  return appUrl()
}

/** An absolute URL on the public site, for a path that already carries its locale. */
export function absoluteSiteUrl(path: string): string {
  return new URL(path, siteUrl()).toString()
}
