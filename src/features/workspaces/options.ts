/**
 * Currencies and timezones a workspace can pick. Only the codes live here: the
 * names a reader sees come from `Intl`, in the reader's language, so there is no
 * English label to leak into a pt-br page. Build option lists on the server
 * (`currencyOptions`, `timezoneOptions`) so the text cannot differ at hydration.
 */
export const CURRENCY_CODES = ["USD", "EUR", "GBP", "BRL", "CAD", "AUD"] as const

/**
 * Kept for callers that still read `.label`: the English name is only a fallback
 * for a runtime without `Intl.DisplayNames`. Prefer `currencyOptions(locale)`.
 */
export const CURRENCIES = CURRENCY_CODES.map((code) => ({
  code,
  label: displayName("en-US", code),
}))

export const TIMEZONES = [
  "UTC",
  "America/Sao_Paulo",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Lisbon",
  "Asia/Singapore",
  "Australia/Sydney",
] as const

export interface SelectOption {
  value: string
  label: string
}

function displayName(locale: string, code: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "currency" }).of(code) ?? code
  } catch {
    return code
  }
}

/** `BRL — Real brasileiro` in pt-BR, `BRL — Brazilian Real` in en-US. */
export function currencyOptions(locale: string): SelectOption[] {
  return CURRENCY_CODES.map((code) => ({ value: code, label: `${code} — ${displayName(locale, code)}` }))
}

/**
 * `Horário de Brasília (GMT-3)` rather than `America/Sao_Paulo`: the reader
 * recognises the zone by its name and offset. The IANA id stays the value, and
 * trails the label so two zones sharing a generic name remain distinguishable.
 */
export function timezoneOptions(locale: string, now = new Date()): SelectOption[] {
  return TIMEZONES.map((zone) => {
    const part = (timeZoneName: "longGeneric" | "shortOffset") => {
      try {
        return new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName })
          .formatToParts(now)
          .find((p) => p.type === "timeZoneName")?.value
      } catch {
        return undefined
      }
    }
    const name = part("longGeneric")
    const offset = part("shortOffset")
    if (zone === "UTC" || !name || !offset) return { value: zone, label: zone.replace(/_/g, " ") }
    return { value: zone, label: `${name} (${offset}) · ${zone.replace(/_/g, " ")}` }
  })
}
