import { useLocale, useTranslations } from "next-intl"

import { InlineAlert } from "@/components/feedback/inline-alert"
import { SectionHeader } from "@/components/layout/page-header"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { createFormatters } from "@/lib/money"
import { nextPlan, PLAN_RESOURCES, upgradeLines, type PlanResource } from "@/lib/plans"
import { cn } from "@/lib/utils"
import type { PlanOverview } from "@/server/services/plans"

import { PlanLineList } from "./plan-lines"
import { RequestUpgradeForm } from "./request-upgrade-form"

/** More segments than this and a bar stops being countable; it scales instead. */
const MAX_SEGMENTS = 20

function UsageMeter({
  resource,
  used,
  limit,
}: {
  resource: PlanResource
  used: number
  limit: number | null
}) {
  const t = useTranslations("plans.panel")
  const f = createFormatters(useLocale())
  const labelId = `plan-usage-${resource}`
  const atLimit = limit !== null && used >= limit
  const value =
    limit === null
      ? t("usageUnlimited", { used: f.number(used) })
      : t("usageOf", { used: f.number(used), limit: f.number(limit) })

  // Segments rather than a width, so the bar needs no inline style; one
  // segment per unit while the limit is small enough to count.
  const segments = limit === null ? 0 : Math.min(limit, MAX_SEGMENTS)
  const filled =
    limit === null || limit === 0
      ? 0
      : limit <= MAX_SEGMENTS
        ? Math.min(used, limit)
        : Math.round((Math.min(used, limit) / limit) * MAX_SEGMENTS)

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <span id={labelId} className="text-caption text-foreground-secondary">
          {t(`resources.${resource}`)}
        </span>
        <span className="flex items-center gap-2">
          {atLimit ? <Badge tone="warning">{t("atLimit")}</Badge> : null}
          <span className="text-caption tabular-nums text-foreground">{value}</span>
        </span>
      </div>
      {limit === null ? null : (
        <div
          role="progressbar"
          aria-labelledby={labelId}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
          aria-valuetext={value}
          className="mt-2 flex gap-1"
        >
          {Array.from({ length: segments }, (_, index) => (
            <span
              key={index}
              className={cn("h-1 flex-1 rounded-full", index < filled ? "bg-foreground-secondary" : "bg-fill-strong")}
            />
          ))}
        </div>
      )}
      {resource === "members" ? (
        <p className="mt-1.5 text-meta text-muted-foreground">{t("membersHint")}</p>
      ) : null}
    </li>
  )
}

/**
 * Settings → Plan: the workspace's plan, usage against each limit, and the way
 * up. There is no checkout — a request is recorded, the team gets in touch and
 * the operator switches the plan — and the copy says exactly that.
 *
 * Load with `getPlanOverview(user.id, workspace.id)` from
 * `@/server/services/plans`.
 */
export function PlanPanel({
  overview,
  workspaceId,
  canManage,
}: {
  overview: PlanOverview
  workspaceId: string
  /** Owner or admin: may file an upgrade request. */
  canManage: boolean
}) {
  const t = useTranslations("plans.panel")
  const tn = useTranslations("plans.names")
  const f = createFormatters(useLocale())
  const upgrade = nextPlan(overview.plan)
  const openRequest = overview.openRequest

  return (
    <section>
      <SectionHeader title={t("title")} description={t("description")} className="mb-3" />

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="text-meta text-muted-foreground">{t("current")}</p>
            <p className="mt-0.5 text-title text-foreground">
              {tn(overview.plan)}
            </p>
            <p className="mt-1 text-pretty text-caption text-muted-foreground">
              {t(`summary.${overview.plan}`)}
            </p>
          </div>
        </div>

        <div className="px-4 py-4 sm:px-5">
          <h3 className="sr-only">{t("usageTitle")}</h3>
          <ul className="divide-y divide-border-faint">
            {PLAN_RESOURCES.map((resource) => (
              <UsageMeter
                key={resource}
                resource={resource}
                used={overview.usage[resource]}
                limit={overview.limits[resource]}
              />
            ))}
          </ul>
        </div>

        {upgrade ? (
          <div className="space-y-4 border-t border-border px-4 py-4 sm:px-5">
            <div>
              <h3 className="text-caption font-medium text-foreground">
                {t("upgradeTitle", { plan: tn(upgrade) })}
              </h3>
              <PlanLineList lines={upgradeLines(overview.plan, upgrade)} className="mt-3" />
            </div>

            <p className="max-w-[68ch] text-pretty text-caption text-muted-foreground">
              {t("noBilling", { plan: tn(upgrade) })}
            </p>

            {openRequest ? (
              <InlineAlert tone="success">
                {t("requested", {
                  plan: tn(openRequest.requestedPlan),
                  date: f.date(openRequest.createdAt, "medium"),
                })}
              </InlineAlert>
            ) : canManage ? (
              <RequestUpgradeForm workspaceId={workspaceId} plan={upgrade} />
            ) : (
              <InlineAlert>{t("readOnly")}</InlineAlert>
            )}
          </div>
        ) : (
          <p className="border-t border-border px-4 py-3 text-caption text-muted-foreground sm:px-5">
            {t("highest")}
          </p>
        )}
      </Card>
    </section>
  )
}
