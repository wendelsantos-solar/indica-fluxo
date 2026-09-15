import { clientEnv } from "@/lib/env/client"

/**
 * The public origin, for canonical URLs, OpenGraph and e-mail redirects.
 *
 * `next build` collects metadata without a configured environment, so an
 * invalid or missing value falls back to the dev origin instead of failing the
 * build; `clientEnv()` still rejects a bad value at runtime everywhere else.
 */
export function siteUrl(): URL {
  try {
    return new URL(clientEnv().NEXT_PUBLIC_APP_URL)
  } catch {
    return new URL("http://localhost:3000")
  }
}

/**
 * Canonical and `hreflang` alternates for a public page. Every locale is
 * prefixed and pathnames are translated, so each alternate is resolved through
 * the routing table rather than by swapping a prefix.
 */
export function localeAlternates(
  href: "/" | "/pricing" | "/docs",
  locale: string,
  resolve: (target: "pt-br" | "en") => string,
) {
  const url = (target: "pt-br" | "en") => new URL(resolve(target), siteUrl()).toString()
  return {
    canonical: url(locale === "en" ? "en" : "pt-br"),
    languages: { "pt-BR": url("pt-br"), "en-US": url("en"), "x-default": url("pt-br") },
    href,
  }
}
