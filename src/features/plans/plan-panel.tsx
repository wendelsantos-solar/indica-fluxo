import { getTranslations } from "next-intl/server"
import type * as React from "react"

import { InlineAlert } from "@/components/feedback/inline-alert"
import { SectionHeader } from "@/components/layout/page-header"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { BillingPortalButton, CheckoutButton } from "@/features/billing/billing-buttons"
import { getFormatters } from "@/i18n/format"
import type { Formatters } from "@/lib/money"
import { PLAN_OFFERS, type PlanCode } from "@/lib/plans"
import { cn } from "@/lib/utils"
import type { BillingOverview } from "@/server/services/platform-billing"
import type { PlanOverview } from "@/server/services/plans"

import {
  billingStatusLabel,
  planOptions,
  usageMeters,
  usageValue,
  type PlanOption,
  type UsageMeter,
} from "./plan-display"
import { PlanLineList } from "./plan-lines"
import { RequestUpgradeForm } from "./request-upgrade-form"

/** More segments than this and a bar stops being countable; it scales instead. */
const MAX_SEGMENTS = 20

type Translator = Awaited<ReturnType<typeof getTranslations>>

function priceLabel(t: Translator, f: Formatters, plan: PlanCode): string | null {
  const { priceMonthlyMinor, currency } = PLAN_OFFERS[plan]
  if (priceMonthlyMinor === null) return null
  if (priceMonthlyMinor === 0) return t("free")
  return t("perMonth", { price: f.money(priceMonthlyMinor, currency) })
}

/**
 * Settings → Plano e cobrança (docs/PLANS.md §5–§6): the current plan, its
 * state and price, the next charge, usage against every limit, and the way to
 * another plan — Stripe Checkout from Sandbox, the Billing Portal between paid
 * plans, a manual request where platform billing is not configured.
 *
 * Load with `getBillingOverview` (`@/server/services/platform-billing`) and
 * `getPlanOverview` (`@/server/services/plans`). The `?billing=` query of the
 * Stripe redirect is only a notice: the state shown is always the database's.
 */
export async function PlanPanel({
  workspaceSlug,
  workspaceId,
  billing,
  overview,
  billingReturn,
  timeZone,
}: {
  workspaceSlug: string
  workspaceId: string
  billing: BillingOverview
  overview: PlanOverview
  /** `?billing=` on the return from Stripe. */
  billingReturn?: "success" | "cancelled"
  /** The workspace's IANA zone, for dates. */
  timeZone?: string
}) {
  const t = await getTranslations("plans.panel")
  const tn = await getTranslations("plans.names")
  const f = await getFormatters(timeZone)

  const subscribed = billing.standing === "sandbox" ? "sandbox" : billing.subscribedPlan
  const status = billingStatusLabel(billing)
  const statusText =
    status.key === "grace" && status.date
      ? t("status.graceUntil", { date: f.date(status.date, "medium") })
      : status.key === "cancelling" && status.date
        ? t("status.cancellingOn", { date: f.date(status.date, "medium") })
        : status.key === "trialing" && status.date
          ? t("status.trialingUntil", { date: f.date(status.date, "medium") })
          : t(`status.${status.key === "cancelling" ? "active" : status.key}`)

  const chargeLine =
    billing.standing === "sandbox"
      ? t("charge.sandbox")
      : billing.standing === "restricted"
        ? t("charge.restricted")
        : billing.standing === "grace"
          ? t("charge.grace")
          : billing.endsAt
            ? t("charge.endsOn", { date: f.date(billing.endsAt, "medium") })
            : billing.currentPeriodEnd
              ? t("charge.nextOn", { date: f.date(billing.currentPeriodEnd, "medium") })
              : billing.provider === "manual"
                ? t("charge.manual")
                : null

  const canOpenPortal = billing.configured && billing.canManageBilling && billing.viewerCanManage
  const meters = usageMeters(overview.usage, overview.entitlements.capabilities.limits)
  const over = meters.some((meter) => meter.state === "over")
  const options = planOptions(billing)
  const openRequest = overview.openRequest

  return (
    <section>
      <SectionHeader title={t("title")} description={t("description")} className="mb-3" />

      {billingReturn === "success" ? (
        <InlineAlert className="mb-4">{t("return.success")}</InlineAlert>
      ) : billingReturn === "cancelled" ? (
        <InlineAlert className="mb-4">{t("return.cancelled")}</InlineAlert>
      ) : null}

      <Card>
        {/* 1 — The current plan. */}
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-border px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <p className="text-meta text-muted-foreground">{t("current")}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <p className="text-title text-foreground">{tn(subscribed)}</p>
              <Badge tone={status.tone}>{statusText}</Badge>
            </div>
            <p className="mt-1 max-w-[68ch] text-pretty text-caption text-muted-foreground">
              {t(`summary.${subscribed}`)}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <div className="sm:text-right">
              <p className="text-title tabular-nums text-foreground">{priceLabel(t, f, subscribed)}</p>
              {chargeLine ? <p className="text-meta text-muted-foreground">{chargeLine}</p> : null}
            </div>
            {canOpenPortal ? (
              <BillingPortalButton workspaceSlug={workspaceSlug} label={t("manage")} size="sm" />
            ) : null}
          </div>
        </div>

        {/* 2 — Usage against each limit. */}
        <div className="px-4 py-4 sm:px-5">
          <h3 className="text-caption font-medium text-foreground">{t("usageTitle")}</h3>
          {over ? (
            <InlineAlert tone="danger" title={t("overLimit.title")} className="mt-3">
              {t("overLimit.body")}
            </InlineAlert>
          ) : null}
          <ul className="mt-3 divide-y divide-border-faint">
            {meters.map((meter) => (
              <UsageRow key={meter.limit} meter={meter} t={t} f={f} planName={tn(subscribed)} />
            ))}
          </ul>
        </div>

        {/* 3 — Where the plan can go. */}
        {options.length === 0 ? (
          <p className="border-t border-border px-4 py-3 text-caption text-muted-foreground sm:px-5">{t("highest")}</p>
        ) : (
          <div className="border-t border-border">
            <div className="px-4 pt-4 sm:px-5">
              <h3 className="text-caption font-medium text-foreground">
                {subscribed === "sandbox" ? t("options.activateTitle") : t("options.changeTitle")}
              </h3>
              {subscribed === "sandbox" ? (
                <p className="mt-1 max-w-[68ch] text-pretty text-caption text-muted-foreground">
                  {t("options.activateDescription")}
                </p>
              ) : null}
              {openRequest ? (
                <InlineAlert tone="success" className="mt-3">
                  {t("manualRequest.sent", {
                    plan: tn(openRequest.requestedPlan),
                    date: f.date(openRequest.createdAt, "medium"),
                  })}
                </InlineAlert>
              ) : null}
            </div>

            <div
              className={cn(
                "grid gap-y-4 px-4 py-4 sm:px-5",
                options.length > 1 && "sm:grid-cols-2 sm:gap-x-8",
              )}
            >
              {options.map((option) => (
                <PlanOptionBlock
                  key={option.plan}
                  option={option}
                  workspaceSlug={workspaceSlug}
                  workspaceId={workspaceId}
                  canManage={billing.viewerCanManage}
                  requested={openRequest !== null}
                  t={t}
                  f={f}
                  name={tn(option.plan)}
                />
              ))}
            </div>

            <div className="space-y-2 border-t border-border-faint px-4 py-3 sm:px-5">
              {!billing.viewerCanManage ? (
                <p className="text-caption text-muted-foreground">{t("readOnly")}</p>
              ) : !billing.configured ? (
                <p className="max-w-[68ch] text-pretty text-caption text-muted-foreground">{t("manualRequest.note")}</p>
              ) : null}
              <p className="max-w-[68ch] text-pretty text-meta text-muted-foreground">{t("core")}</p>
            </div>
          </div>
        )}
      </Card>
    </section>
  )
}

function UsageRow({
  meter,
  t,
  f,
  planName,
}: {
  meter: UsageMeter
  t: Translator
  f: Formatters
  planName: string
}) {
  const labelId = `plan-usage-${meter.limit}`
  const figure = usageValue(meter)
  const value =
    figure.key === "usageOf"
      ? t("usageOf", { used: f.number(figure.values.used), limit: f.number(figure.values.limit) })
      : figure.key === "usageCount"
        ? f.number(figure.values.used)
        : t("usageUnavailable", { plan: planName })

  const max = meter.max
  const segments = max === null || max === 0 ? 0 : Math.min(max, MAX_SEGMENTS)
  const capped = max === null ? 0 : Math.min(meter.used, max)
  const filled = max === null || max === 0 ? 0 : max <= MAX_SEGMENTS ? capped : Math.round((capped / max) * MAX_SEGMENTS)

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span id={labelId} className="text-caption text-foreground-secondary">
          {t(`resources.${meter.limit}`)}
        </span>
        <span className="flex items-center gap-2">
          {meter.state === "over" ? (
            <Badge tone="danger">{t("over")}</Badge>
          ) : meter.state === "atLimit" ? (
            <Badge tone="warning">{t("atLimit")}</Badge>
          ) : null}
          <span
            className={cn(
              "text-caption tabular-nums",
              meter.state === "unavailable" ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {value}
          </span>
        </span>
      </div>
      {segments > 0 && max !== null ? (
        <div
          role="progressbar"
          aria-labelledby={labelId}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={capped}
          aria-valuetext={value}
          className="mt-2 flex gap-1"
        >
          {Array.from({ length: segments }, (_, index) => (
            <span
              key={index}
              className={cn(
                "h-1 flex-1 rounded-full",
                index < filled ? (meter.state === "over" ? "bg-danger" : "bg-foreground-secondary") : "bg-fill-strong",
              )}
            />
          ))}
        </div>
      ) : null}
      {meter.limit === "members" ? <p className="mt-1.5 text-meta text-muted-foreground">{t("membersHint")}</p> : null}
      {meter.limit === "affiliates" && meter.max !== null ? (
        <p className="mt-1.5 text-meta text-muted-foreground">{t("affiliatesHint")}</p>
      ) : null}
    </li>
  )
}

function PlanOptionBlock({
  option,
  workspaceSlug,
  workspaceId,
  canManage,
  requested,
  t,
  f,
  name,
}: {
  option: PlanOption
  workspaceSlug: string
  workspaceId: string
  canManage: boolean
  requested: boolean
  t: Translator
  f: Formatters
  name: string
}) {
  const plan = option.plan as "launch" | "growth"
  const { action } = option

  let control: React.ReactNode = null
  if (canManage) {
    if (action.kind === "checkout") {
      control = <CheckoutButton workspaceSlug={workspaceSlug} plan={plan} label={t("actions.activate", { name })} />
    } else if (action.kind === "portalChange") {
      control = (
        <BillingPortalButton workspaceSlug={workspaceSlug} plan={plan} label={t("actions.change", { name })} />
      )
    } else if (action.kind === "request") {
      control = requested ? null : (
        <RequestUpgradeForm workspaceId={workspaceId} plan={plan} label={t("actions.request", { name })} />
      )
    } else {
      control = <p className="text-caption text-muted-foreground">{t("actions.contact", { name })}</p>
    }
  }

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-caption font-medium text-foreground">{name}</h4>
        {option.recommended ? <Badge dot={false}>{t("recommended")}</Badge> : null}
      </div>
      <p className="mt-0.5 text-caption tabular-nums text-foreground-secondary">{priceLabel(t, f, option.plan)}</p>
      <p className="mt-1 text-pretty text-caption text-muted-foreground">{t(`summary.${option.plan}`)}</p>
      <PlanLineList plan={option.plan} className="mt-3" />
      {option.downgrade ? (
        <p className="mt-3 text-pretty text-meta text-muted-foreground">{t("downgradeNote", { name })}</p>
      ) : null}
      {control ? <div className="mt-4">{control}</div> : null}
    </div>
  )
}
