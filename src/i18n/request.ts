import { hasLocale } from "next-intl"
import { getRequestConfig } from "next-intl/server"

import { BRAND } from "@/lib/brand"

import { routing, type Locale } from "./routing"

type Catalogue = { [key: string]: string | Catalogue | Catalogue[] | string[] }

/**
 * Catalogues write the product's name as `{brand}` (never the name itself), so
 * a rename is one line in `src/lib/brand.ts`. It is substituted here, once per
 * catalogue load, before next-intl parses a single message — which is also why
 * `{brand}` never has to be passed as an argument.
 */
export function withBrand(messages: Catalogue, name: string = BRAND.name): Catalogue {
  const out: Catalogue = {}
  for (const [key, value] of Object.entries(messages)) out[key] = brandValue(value, name) as Catalogue[string]
  return out
}

/** Strings get the name; arrays stay arrays (read with `t.raw`, e.g. the legal pages' paragraphs). */
function brandValue(value: Catalogue[string], name: string): unknown {
  if (typeof value === "string") return value.replaceAll("{brand}", name)
  if (Array.isArray(value)) return value.map((item) => brandValue(item as Catalogue[string], name))
  return withBrand(value, name)
}

const branded = new Map<Locale, Catalogue>()

async function loadMessages(locale: Locale): Promise<Catalogue> {
  const cached = branded.get(locale)
  if (cached) return cached
  const messages = withBrand((await import(`./messages/${locale}.json`)).default as Catalogue)
  branded.set(locale, messages)
  return messages
}

/**
 * Resolves the request's locale and loads its catalogue.
 *
 * `formats` centralises every Intl option the product uses, so a date or a
 * percentage is formatted the same way in every view without each caller
 * re-deriving the options. Money is deliberately absent: an amount is stored
 * with its own ISO-4217 currency and is formatted by `lib/money.ts`, which must
 * never substitute the reader's currency for the ledger's.
 *
 * The locale string doubles as the BCP 47 tag — `Intl` matches it
 * case-insensitively, so "pt-br" and "pt-BR" resolve identically. `BCP47` in
 * ./routing exists for the places that must emit the canonical casing:
 * `<html lang>` and `hreflang`.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale
  const locale: Locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale

  return {
    locale,
    messages: await loadMessages(locale),
    timeZone: "UTC",
    formats: {
      dateTime: {
        short: { day: "2-digit", month: "2-digit", year: "numeric" },
        medium: { day: "numeric", month: "short", year: "numeric" },
        long: { day: "numeric", month: "long", year: "numeric" },
      },
      number: {
        percent: { style: "percent", maximumFractionDigits: 1 },
        compact: { notation: "compact", maximumFractionDigits: 1 },
      },
    },
  }
})
