import { getTranslations } from "next-intl/server"

import { Link } from "@/i18n/navigation"
import { cn } from "@/lib/utils"

export const INTEGRATION_TABS = ["overview", "payments", "tracking", "api"] as const
export type IntegrationTab = (typeof INTEGRATION_TABS)[number]

export function integrationTab(value: unknown): IntegrationTab {
  return (INTEGRATION_TABS as readonly unknown[]).includes(value) ? (value as IntegrationTab) : "overview"
}

/**
 * Overview · Payments · Tracking · API — tabs inside Integrations instead of new
 * sidebar items (brief §38). Links, not client tabs: each tab renders only the
 * data it needs, and a tab is a URL a founder can share.
 */
export async function IntegrationTabs({
  workspaceSlug,
  current,
  counts,
}: {
  workspaceSlug: string
  current: IntegrationTab
  counts?: Partial<Record<IntegrationTab, number>>
}) {
  const t = await getTranslations("dashboard.integrations.tabs")
  return (
    <nav aria-label={t("label")} className="-mt-2 mb-8 border-b border-border">
      <ul className="-mb-px flex gap-5 overflow-x-auto">
        {INTEGRATION_TABS.map((tab) => (
          <li key={tab}>
            <Link
              href={{ pathname: "/[workspaceSlug]/integrations", params: { workspaceSlug }, query: tab === "overview" ? {} : { tab } }}
              aria-current={tab === current ? "page" : undefined}
              className={cn(
                "flex h-9 items-center gap-1.5 whitespace-nowrap border-b-2 text-caption transition-colors",
                tab === current
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t(tab)}
              {counts?.[tab] ? <span className="tabular-nums text-faint-foreground">{counts[tab]}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
