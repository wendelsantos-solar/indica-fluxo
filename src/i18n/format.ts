import { getLocale, getTimeZone } from "next-intl/server"

import { createFormatters, type Formatters } from "@/lib/money"
import { resolveTimeZone } from "@/lib/time-zone"

/**
 * Locale-bound formatters for a server component.
 *
 *   const f = await getFormatters()
 *   f.money(commission.amountMinor, commission.currency)
 *
 * One call per render replaces threading the locale through every helper.
 *
 * Dates are calendar facts of a workspace, so views inside a workspace pass
 * its IANA `timeZone` (a 22:00 São Paulo conversion is not "tomorrow"). Without
 * one, the request's configured zone is used (`src/i18n/request.ts`). A zone
 * this runtime does not support falls back to UTC instead of throwing mid-render.
 */
export async function getFormatters(timeZone?: string): Promise<Formatters> {
  return createFormatters(await getLocale(), resolveTimeZone(timeZone ?? (await getTimeZone())))
}
