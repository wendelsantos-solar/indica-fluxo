import { hasLocale } from "next-intl"
import { getRequestConfig } from "next-intl/server"

import { routing, type Locale } from "./routing"

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
    messages: (await import(`./messages/${locale}.json`)).default,
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
