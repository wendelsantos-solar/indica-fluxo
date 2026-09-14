import { getLocale } from "next-intl/server"

import { createFormatters, type Formatters } from "@/lib/money"

/**
 * Locale-bound formatters for a server component.
 *
 *   const f = await getFormatters()
 *   f.money(commission.amountMinor, commission.currency)
 *
 * One call per render replaces threading the locale through every helper.
 */
export async function getFormatters(): Promise<Formatters> {
  return createFormatters(await getLocale())
}
