import { getTranslations } from "next-intl/server"

import { InlineAlert } from "@/components/feedback/inline-alert"
import { Button } from "@/components/ui/button"
import { getFormatters } from "@/i18n/format"
import { Link } from "@/i18n/navigation"
import { PLAN_OFFERS } from "@/lib/plans"

import type { ProgramAvailability } from "./plan-availability"

/**
 * Why no (more) programs can be created, and where that changes: Settings →
 * Plano e cobrança. Renders nothing when a program can be created and no limit
 * is in the way.
 */
export async function ProgramPlanNotice({
  workspaceSlug,
  availability,
  id,
  className,
}: {
  workspaceSlug: string
  availability: ProgramAvailability
  /** For the disabled "New program" button's `aria-describedby`. */
  id?: string
  className?: string
}) {
  const t = await getTranslations("dashboard.programs.planNotice")
  const f = await getFormatters()
  const planHref = { pathname: "/[workspaceSlug]/settings", params: { workspaceSlug }, hash: "plano" } as const

  if (availability.restricted) {
    return (
      <div id={id} className={className}>
        <InlineAlert
          title={t("restrictedTitle")}
          action={
            <Button asChild variant="ghost" size="sm">
              <Link href={planHref}>{t("restrictedAction")}</Link>
            </Button>
          }
        >
          {t("restrictedBody")}
        </InlineAlert>
      </div>
    )
  }

  const plan = availability.upgradeTo
  if (!plan) return null
  const price = PLAN_OFFERS[plan].priceMonthlyMinor

  return (
    <div id={id} className={className}>
      <InlineAlert
        title={t("upgradeTitle", { plan })}
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href={planHref}>{t("upgradeAction", { plan })}</Link>
          </Button>
        }
      >
        {price ? t("upgradePrice", { price: f.money(price, PLAN_OFFERS[plan].currency) }) : null}
      </InlineAlert>
    </div>
  )
}
