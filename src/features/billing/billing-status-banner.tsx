import { CircleAlert, Info, TriangleAlert } from "lucide-react"
import { useLocale, useTimeZone, useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"
import { formatDate } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { Standing } from "@/server/domain/entitlements"

import { billingBannerKind } from "./billing-banner"

export interface BillingStatusBannerProps {
  workspaceSlug: string
  /** `entitlements.standing` (or `getBillingOverview().standing`). */
  standing: Standing
  /** `entitlements.subscribedPlan`: the plan paid for. */
  subscribedPlan: string
  /** Set while `past_due`: when live mode stops. */
  graceEndsAt: Date | null
  /** Set when the subscription will not renew. */
  endsAt: Date | null
  /** Owner or admin: the banner links to Settings → Plano e cobrança to fix it. */
  canManage: boolean
  className?: string
}

const TONE = {
  grace: { icon: TriangleAlert, border: "border-warning/30", tint: "text-warning-foreground", role: "status" },
  restricted: { icon: CircleAlert, border: "border-danger/30", tint: "text-danger-foreground", role: "alert" },
  ending: { icon: Info, border: "border-border", tint: "text-muted-foreground", role: "status" },
} as const

/**
 * The workspace-wide billing notice (docs/PLANS.md §6), for the top of the
 * dashboard content:
 *
 * - `grace`      — warning: pay before `graceEndsAt` or live mode stops
 * - `restricted` — danger: live paused, creation blocked, data still readable
 * - `endsAt`     — neutral: the plan ends on that date
 * - `sandbox` / `active` without an end — nothing
 *
 * No client hooks beyond next-intl's: renders from a server layout as is.
 *
 *   <BillingStatusBanner
 *     workspaceSlug={workspace.slug}
 *     standing={entitlements.standing}
 *     subscribedPlan={entitlements.subscribedPlan}
 *     graceEndsAt={entitlements.graceEndsAt}
 *     endsAt={entitlements.endsAt}
 *     canManage={role === "owner" || role === "admin"}
 *   />
 */
export function BillingStatusBanner({
  workspaceSlug,
  standing,
  subscribedPlan,
  graceEndsAt,
  endsAt,
  canManage,
  className,
}: BillingStatusBannerProps) {
  const t = useTranslations("billing.banner")
  const tn = useTranslations("plans.names")
  const locale = useLocale()
  const timeZone = useTimeZone() ?? "UTC"

  const kind = billingBannerKind({ standing, endsAt })
  if (!kind) return null

  const date = (value: Date | null) => (value ? formatDate(locale, value, "medium", timeZone) : "")
  const plan = tn.has(subscribedPlan) ? tn(subscribedPlan) : subscribedPlan
  const message =
    kind === "grace"
      ? t("grace", { date: date(graceEndsAt) })
      : kind === "restricted"
        ? t("restricted")
        : t("ending", { plan, date: date(endsAt) })

  const { icon: Icon, border, tint: iconClass, role } = TONE[kind]

  return (
    <div
      role={role}
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control border bg-surface-1 px-3 py-2.5", border, className)}
    >
      <Icon className={cn("size-4 shrink-0", iconClass)} aria-hidden="true" />
      <p className="min-w-0 flex-1 text-caption text-foreground-secondary">
        {message}
        {canManage || kind === "ending" ? null : <span className="text-muted-foreground"> {t("askOwner")}</span>}
      </p>
      {canManage ? (
        <Button asChild variant={kind === "ending" ? "ghost" : "secondary"} size="sm">
          <Link href={{ pathname: "/[workspaceSlug]/settings", params: { workspaceSlug }, hash: "plano" }}>
            {kind === "ending" ? t("actionEnding") : t("actionPayment")}
          </Link>
        </Button>
      ) : null}
    </div>
  )
}
