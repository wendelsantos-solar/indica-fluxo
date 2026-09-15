import { getTranslations } from "next-intl/server"

import { InlineAlert } from "@/components/feedback/inline-alert"
import { Button } from "@/components/ui/button"
import { getFormatters } from "@/i18n/format"
import { Link } from "@/i18n/navigation"
import { cheapestPlanForLimit, PLAN_OFFERS } from "@/lib/plans"
import type { Entitlements, PlanUsage } from "@/server/domain/entitlements"

/**
 * Said on the affiliates list when the workspace is at (or, after a downgrade,
 * over) the plan's affiliates limit: existing affiliates keep working, but new
 * affiliates and approvals are refused until a slot frees or the plan changes
 * (docs/PLANS.md §3, §6). Renders nothing below the limit.
 */
export async function AffiliateLimitNotice({
  workspaceSlug,
  entitlements,
  usage,
  className,
}: {
  workspaceSlug: string
  entitlements: Entitlements
  usage: PlanUsage
  className?: string
}) {
  const limit = entitlements.capabilities.limits.affiliates
  if (limit === null || usage.affiliates < limit) return null

  const t = await getTranslations("dashboard.affiliates.planLimit")
  const f = await getFormatters()
  const upgradeTo = cheapestPlanForLimit("affiliates", usage.affiliates + 1)
  const price = upgradeTo ? PLAN_OFFERS[upgradeTo].priceMonthlyMinor : null

  return (
    <div className={className}>
      <InlineAlert
        title={
          usage.affiliates > limit
            ? t("overTitle", { used: usage.affiliates, limit })
            : t("atTitle", { limit })
        }
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href={{ pathname: "/[workspaceSlug]/settings", params: { workspaceSlug }, hash: "plano" }}>
              {t("action")}
            </Link>
          </Button>
        }
      >
        {upgradeTo && price
          ? t("bodyUpgrade", { plan: upgradeTo, price: f.money(price, PLAN_OFFERS[upgradeTo].currency) })
          : t("body")}
      </InlineAlert>
    </div>
  )
}
