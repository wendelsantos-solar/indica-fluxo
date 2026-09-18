import { getTranslations } from "next-intl/server"

import { COOKIES, type CookieEntry } from "@/lib/legal/cookies"

/** The cookies of one place (our site, or a customer's site via the tracker), from the inventory. */
export async function CookieTable({ where }: { where: CookieEntry["where"] }) {
  const t = await getTranslations("legal.cookies")
  const rows = COOKIES.filter((cookie) => cookie.where === where)
  return (
    <div data-slot="scrollable" className="overflow-x-auto rounded-panel border border-border">
      <table className="w-full min-w-lg border-collapse text-caption">
        <thead className="bg-surface-2">
          <tr>
            {(["name", "category", "purpose", "duration"] as const).map((column) => (
              <th key={column} scope="col" className="h-9 px-3 text-left font-normal text-muted-foreground">
                {t(`table.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cookie) => (
            <tr key={cookie.name} className="border-t border-border-faint align-top">
              <td className="whitespace-nowrap px-3 py-2.5 font-mono text-meta text-foreground">
                {cookie.name}
                {cookie.storage === "localStorage" ? <span className="block font-sans text-faint-foreground">{t("table.localStorage")}</span> : null}
              </td>
              <td className="px-3 py-2.5 text-foreground-secondary">{t(`categories.${cookie.category}`)}</td>
              <td className="px-3 py-2.5 text-foreground-secondary">{t(`purposes.${cookie.purpose}`)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-foreground-secondary">{t(`durations.${cookie.duration}`)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
