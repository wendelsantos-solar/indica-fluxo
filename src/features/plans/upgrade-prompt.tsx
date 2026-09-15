import { useLocale, useTranslations } from "next-intl"

import { InlineAlert } from "@/components/feedback/inline-alert"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"
import { formatMoney } from "@/lib/money"
import type { PlanCode } from "@/lib/plans"

import { upgradeOffer, type UpgradeReason } from "./plan-display"

export interface UpgradePromptProps {
  /** The limit or feature in the way. */
  reason: UpgradeReason
  workspaceSlug: string
  /** The workspace's subscribed plan: the offer is always above it. */
  currentPlan?: PlanCode
  /** How many of the limited resource are needed (usage + 1). Defaults to one more than the current plan allows. */
  needed?: number
  /** `upgradeTo` from a plan error; used when it is purchasable and above `currentPlan`. */
  upgradeTo?: PlanCode | null
  /** Replaces the headline — the translated error a refused action returned. */
  message?: string
  className?: string
}

/**
 * "Vários programas estão disponíveis no Growth. R$ 197/mês [Conhecer Growth]"
 * — the one way the product says a plan stands in the way. The plan and price
 * come from `src/lib/plans.ts`; the action leads to Settings → Plano e cobrança.
 *
 * No hooks beyond next-intl's, so it renders in server and client components
 * alike. Renders nothing when no purchasable plan would help.
 *
 *   <UpgradePrompt reason="livePrograms" workspaceSlug={slug} currentPlan={entitlements.subscribedPlan} />
 */
export function UpgradePrompt({
  reason,
  workspaceSlug,
  currentPlan,
  needed,
  upgradeTo,
  message,
  className,
}: UpgradePromptProps) {
  const t = useTranslations("plans.upgrade")
  const tn = useTranslations("plans.names")
  const locale = useLocale()

  const offer = upgradeOffer(reason, { currentPlan, needed, upgradeTo })
  if (!offer) return null

  const name = tn(offer.plan)
  const price =
    offer.priceMonthlyMinor !== null && offer.priceMonthlyMinor > 0
      ? t("price", { price: formatMoney(locale, offer.priceMonthlyMinor, offer.currency) })
      : null

  return (
    <InlineAlert
      className={className}
      title={message ?? t(`title.${reason}`, { plan: offer.plan, name })}
      action={
        <Button asChild variant="secondary" size="sm">
          <Link href={{ pathname: "/[workspaceSlug]/settings", params: { workspaceSlug }, hash: "plano" }}>
            {t("action", { name })}
          </Link>
        </Button>
      }
    >
      {price}
    </InlineAlert>
  )
}
