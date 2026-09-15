import { ArrowRight, BarChart3, Coins, Receipt, Users } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { Suspense } from "react"

import { Link } from "@/i18n/navigation"

import { AreaChart, ChartLegend } from "@/components/data-display/area-chart"
import { EmptyState } from "@/components/feedback/empty-state"
import { getFormatters } from "@/i18n/format"
import { Funnel } from "@/components/data-display/funnel"
import { Metric, MetricCell, MetricGrid } from "@/components/data-display/metric"
import { PageHeader, SectionHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import {
  amountIn,
  formatMoneyTotals,
  formatMoneyTotalsInline,
  hasNonZeroTotal,
  type MoneyTotal,
} from "@/lib/money-totals"
import { ActivationChecklist, ActivationReminder } from "@/features/onboarding/activation-checklist"
import {
  activationSignals,
  getActivation,
  shouldShowActivationChecklist,
} from "@/features/onboarding/activation"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import {
  getConversionFunnel,
  getDashboardOverview,
  getRecentConversions,
  getRevenueSeries,
  getTopAffiliates,
} from "@/server/repositories/analytics"
import { listAffiliates } from "@/server/repositories/affiliates"
import { listPrograms } from "@/server/repositories/programs"
import { getIntegrationHealth } from "@/server/services/integration-health"
import { getWorkspaceForUser } from "@/server/services/workspaces"

import { OverviewSkeleton } from "./overview-skeleton"

export const dynamic = "force-dynamic"

/** Every period figure on the page — metrics, chart, funnel — uses this window. */
const PERIOD_DAYS = 30
const CHART_HEIGHT = 220

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/[workspaceSlug]/overview">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.overview" })
  return { title: t("title") }
}

export default async function OverviewPage({
  params,
  searchParams,
}: PageProps<"/[locale]/[workspaceSlug]/overview">) {
  const { workspaceSlug } = await params
  const { welcome } = await searchParams
  const t = await getTranslations("dashboard.overview")

  // The header lives inside the boundary: its description depends on whether
  // the page is the setup checklist or the dashboard. Suspense adds no DOM, so
  // the sticky bar is still a direct child of the shell's content column.
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title={t("title")} description={t("description")} />
          <OverviewSkeleton />
        </>
      }
    >
      <OverviewContent slug={workspaceSlug} welcome={welcome === "1"} />
    </Suspense>
  )
}

async function OverviewContent({ slug, welcome }: { slug: string; welcome: boolean }) {
  const t = await getTranslations("dashboard.overview")
  const tc = await getTranslations("common.table")
  const tm = await getTranslations("common.money")
  const tcs = await getTranslations("dashboard.commissions.statusLabel")
  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, slug)
  const f = await getFormatters(workspace.timezone)
  // One clock for every query: the window starts at local midnight in the
  // workspace's zone and the chart's days are its local dates.
  const period = { days: PERIOD_DAYS, timeZone: f.timeZone, now: new Date() }

  const [health, data] = await Promise.all([
    getIntegrationHealth(user.id, workspace.id),
    withUser(user.id, async (tx) => {
      // The overview decides the lead currency; the chart then draws that one
      // currency only. Statements in one transaction run serially anyway.
      const overview = await getDashboardOverview(tx, workspace.id, period)
      const [series, funnel, topAffiliates, recent, programs, affiliates] = await Promise.all([
        getRevenueSeries(tx, workspace.id, overview.currency, period),
        getConversionFunnel(tx, workspace.id, period),
        getTopAffiliates(tx, workspace.id),
        getRecentConversions(tx, workspace.id),
        // Activation checklist: see features/onboarding/activation.ts for how
        // each step is derived.
        listPrograms(tx, workspace.id),
        listAffiliates(tx, { workspaceId: workspace.id, limit: 1 }),
      ])
      return { overview, series, funnel, topAffiliates, recent, programs, affiliates }
    }),
  ])
  const { overview, series, funnel, topAffiliates, recent, programs, affiliates } = data

  const activation = getActivation(
    activationSignals({ programs, health, affiliateTotal: affiliates.total }),
  )

  const hasOutstandingMoney =
    hasNonZeroTotal(overview.availableCommission) || hasNonZeroTotal(overview.pendingCommission)

  if (
    shouldShowActivationChecklist({
      activation,
      hasCommission: overview.hasCommission,
      hasOutstandingMoney,
    })
  ) {
    return (
      <>
        <PageHeader title={t("title")} description={t("descriptionSetup")} />
        <ActivationChecklist
          workspaceSlug={slug}
          activation={activation}
          programs={programs}
          welcome={welcome}
        />
      </>
    )
  }

  const { currency } = overview
  // Every money figure is per currency: the lead currency is shown as the
  // value, the others on a compact line beside it — never summed or converted.
  const money = (totals: MoneyTotal[]) => formatMoneyTotals(f.money, totals, currency)
  const inline = (totals: MoneyTotal[]) => formatMoneyTotalsInline(f.money, totals, currency)
  const others = (formatted: { others: string | null }) =>
    formatted.others ? tm("otherCurrencies", { amounts: formatted.others }) : null

  const revenue = money(overview.revenue)
  const commission = money(overview.commission)
  const revenueNow = amountIn(overview.revenue, currency)
  const revenueBefore = amountIn(overview.revenuePrevious, currency)
  const delta = revenueBefore > 0 ? ((revenueNow - revenueBefore) / revenueBefore) * 100 : null

  const chartSeries = [
    {
      key: "revenue",
      label: t("legendRevenue"),
      color: "var(--chart-1)",
      values: series.points.map((point) => point.revenueMinor),
    },
    {
      key: "commission",
      label: t("legendCommission"),
      color: "var(--chart-2)",
      values: series.points.map((point) => point.commissionMinor),
    },
  ]
  const chartMax = Math.max(1, ...chartSeries.flatMap((s) => s.values))
  const chartHasData = chartSeries.some((s) => s.values.some((value) => value !== 0))

  // Axis and tooltip dates in the reader's convention ("14 set."), never ISO.
  // Series keys are already local calendar dates, so they format as UTC
  // midnight; an instant (a conversion) formats in the workspace's zone.
  const dayLabel = new Intl.DateTimeFormat(f.locale, { day: "numeric", month: "short", timeZone: "UTC" })
  const instantDayLabel = new Intl.DateTimeFormat(f.locale, { day: "numeric", month: "short", timeZone: f.timeZone })
  const labels = series.points.map((point) => dayLabel.format(new Date(`${point.date}T00:00:00Z`)))
  const activeDays = series.points
    .map((point, index) => ({ ...point, label: labels[index] ?? point.date }))
    .filter((point) => point.revenueMinor !== 0 || point.commissionMinor !== 0)
  const peak = series.points.reduce<(typeof series.points)[number] | null>(
    (best, point) => (best === null || point.revenueMinor > best.revenueMinor ? point : best),
    null,
  )
  const chartSummary = t("chartSummary", {
    start: labels[0] ?? "",
    end: labels[labels.length - 1] ?? "",
    revenue: f.money(
      series.points.reduce((sum, point) => sum + point.revenueMinor, 0),
      series.currency,
    ),
    commission: f.money(
      series.points.reduce((sum, point) => sum + point.commissionMinor, 0),
      series.currency,
    ),
    peakDay: peak ? dayLabel.format(new Date(`${peak.date}T00:00:00Z`)) : "",
    peakRevenue: f.money(peak?.revenueMinor ?? 0, series.currency),
  })
  const chartCurrencyNote =
    series.otherCurrencies.length > 0
      ? t("chartCurrencyNote", {
          currency: series.currency,
          others: new Intl.ListFormat(f.locale, { type: "conjunction" }).format(series.otherCurrencies),
        })
      : null

  // A step with no data source is hidden rather than drawn as a zero that
  // reads like a failure: sign-ups exist only once the server calls identify,
  // subscriptions only once billing reports one.
  const funnelSteps = funnel.filter(
    (step) => step.key === "clicks" || step.key === "customers" || step.value > 0,
  )
  const signupsHidden = !funnelSteps.some((step) => step.key === "signups")
  const funnelHasData = funnel.some((step) => step.value > 0)

  const affiliatesHref = { pathname: "/[workspaceSlug]/affiliates", params: { workspaceSlug: slug } } as const
  const conversionsHref = { pathname: "/[workspaceSlug]/conversions", params: { workspaceSlug: slug } } as const

  return (
    <>
      <PageHeader
        title={t("title")}
        meta={t("period", { days: PERIOD_DAYS })}
        description={t("description")}
      />
      <div className="space-y-10">
        {/* 1 — What the program earned, and what is owed right now. */}
        <div className="space-y-6">
          <ActivationReminder workspaceSlug={slug} activation={activation} />
          <MetricGrid className="sm:grid-cols-2 lg:grid-cols-4">
            {/* The headline figure takes the full row on phones: at half width a
                large amount with a currency symbol would run into its neighbour. */}
            <MetricCell className="col-span-2 sm:col-span-1">
              <Metric
                label={t("metrics.revenue")}
                value={revenue.primary}
                secondaryValue={others(revenue)}
                delta={delta}
                comparison={
                  // The delta compares the lead currency only; say so once
                  // another currency is on screen.
                  revenue.others
                    ? t("metrics.comparisonInCurrency", { currency, days: PERIOD_DAYS })
                    : t("metrics.comparison", { days: PERIOD_DAYS })
                }
                size="lg"
              />
            </MetricCell>
            <MetricCell>
              <Metric
                label={t("metrics.commissions")}
                value={commission.primary}
                secondaryValue={others(commission)}
                comparison={t("metrics.netRevenueAfter", { amount: inline(overview.netRevenue) })}
              />
            </MetricCell>
            <MetricCell>
              <Metric
                label={t("metrics.customers")}
                value={f.number(overview.customersAcquired)}
                comparison={t("metrics.conversionOfClicks", {
                  rate: f.rate(overview.customersAcquired, overview.clicks),
                  clicks: overview.clicks,
                })}
              />
            </MetricCell>
            <MetricCell>
              <Metric
                label={t("metrics.activeAffiliates")}
                value={f.number(overview.activeAffiliates)}
                comparison={t("metrics.ofApproved", { count: overview.approvedAffiliates })}
              />
            </MetricCell>
          </MetricGrid>

          {/* Money owed is all-time, not period: it stays visible in a quiet month. */}
          {hasNonZeroTotal(overview.availableCommission) ? (
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-control border border-border text-muted-foreground">
                    <Coins className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-caption font-medium text-foreground">
                      {t("readyToPay", { amount: inline(overview.availableCommission) })}
                    </p>
                    {hasNonZeroTotal(overview.pendingCommission) ? (
                      <p className="text-meta text-muted-foreground">
                        {t("stillOnHold", { amount: inline(overview.pendingCommission) })}
                      </p>
                    ) : null}
                  </div>
                </div>
                <Button asChild variant="primary" size="sm">
                  <Link href={{ pathname: "/[workspaceSlug]/payouts", params: { workspaceSlug: slug } }}>
                    {t("reviewPayouts")}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>

        {/* 2 — How it is trending. */}
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="min-w-0 lg:col-span-2">
            <CardHeader bordered className="flex-wrap gap-y-2">
              <CardTitle>{t("revenueOverTime")}</CardTitle>
              {chartHasData ? <ChartLegend series={chartSeries} /> : null}
            </CardHeader>
            <CardContent>
              {chartHasData ? (
                <>
                  <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
                    {/* Value axis: the scale's top and its zero, in the chart's currency. */}
                    <div
                      aria-hidden="true"
                      className="flex flex-col justify-between text-right text-meta tabular-nums text-muted-foreground"
                      style={{ height: CHART_HEIGHT }}
                    >
                      <span className="whitespace-nowrap">
                        {f.money(chartMax, series.currency, { compact: true })}
                      </span>
                      <span className="whitespace-nowrap">
                        {f.money(0, series.currency, { compact: true })}
                      </span>
                    </div>
                    <AreaChart
                      labels={labels}
                      series={chartSeries}
                      currency={series.currency}
                      summary={chartSummary}
                      height={CHART_HEIGHT}
                    />
                  </div>
                  {chartCurrencyNote ? (
                    <p className="mt-3 text-meta text-muted-foreground">{chartCurrencyNote}</p>
                  ) : null}
                  {/* The values behind the drawing, reachable by tap and keyboard
                      (the hover tooltip is neither). Only days with movement. */}
                  <details className="group mt-3 border-t border-border-faint pt-3">
                    <summary className="w-fit cursor-pointer rounded-badge text-meta text-muted-foreground transition-colors duration-[120ms] hover:text-foreground">
                      {t("chartValues", { count: activeDays.length })}
                    </summary>
                    <TableContainer className="mt-2 max-h-72 overflow-y-auto">
                      <Table>
                        <caption className="sr-only">
                          {t("chartValuesCaption", { currency: series.currency })}
                        </caption>
                        <THead>
                          <tr>
                            <TH>{tc("date")}</TH>
                            <TH numeric>{t("legendRevenue")}</TH>
                            <TH numeric>{t("legendCommission")}</TH>
                          </tr>
                        </THead>
                        <TBody>
                          {activeDays.map((point) => (
                            <TR key={point.date}>
                              <TD className="h-9 whitespace-nowrap text-muted-foreground">{point.label}</TD>
                              <TD numeric className="h-9">
                                {f.money(point.revenueMinor, series.currency)}
                              </TD>
                              <TD numeric className="h-9">
                                {f.money(point.commissionMinor, series.currency)}
                              </TD>
                            </TR>
                          ))}
                        </TBody>
                      </Table>
                    </TableContainer>
                  </details>
                </>
              ) : (
                <EmptyState
                  icon={BarChart3}
                  title={t("chartEmpty.title", { days: PERIOD_DAYS })}
                  description={t("chartEmpty.description")}
                  className="py-12"
                />
              )}
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader bordered>
              <CardTitle>{t("conversionFunnel")}</CardTitle>
            </CardHeader>
            <CardContent>
              {funnelHasData ? (
                <>
                  <Funnel steps={funnelSteps} />
                  {signupsHidden ? (
                    <p className="mt-4 text-pretty text-meta text-muted-foreground">{t("funnelSignupsHint")}</p>
                  ) : null}
                </>
              ) : (
                <p className="py-12 text-center text-caption text-muted-foreground">
                  {t("funnelEmpty", { days: PERIOD_DAYS })}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 3 — Who and what is behind the numbers. */}
        <div className="grid gap-x-8 gap-y-10 lg:grid-cols-2">
          <section className="min-w-0">
            <SectionHeader
              title={t("topAffiliates")}
              description={t("topAffiliatesScope")}
              action={
                <Button asChild variant="ghost" size="sm">
                  <Link href={{ ...affiliatesHref, query: { sort: "commission", dir: "desc" } }}>
                    {t("viewAllAffiliates")}
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              }
            />
            {topAffiliates.length === 0 ? (
              <EmptyState
                icon={Users}
                title={t("noCommissions")}
                description={t("noCommissionsDescription")}
                className="border-y border-border py-10"
              />
            ) : (
              <TableContainer>
                <Table>
                  <THead>
                    <tr>
                      <TH>{tc("affiliate")}</TH>
                      <TH numeric className="max-sm:hidden">
                        {tc("revenue")}
                      </TH>
                      <TH numeric>{tc("commission")}</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {topAffiliates.map((affiliate) => (
                      <TR key={`${affiliate.participationId}-${affiliate.currency}`}>
                        <TD className="max-w-0">
                          <Link
                            href={{
                              pathname: "/[workspaceSlug]/affiliates/[affiliateId]",
                              params: { workspaceSlug: slug, affiliateId: affiliate.affiliateId },
                            }}
                            className="block truncate rounded-badge text-foreground hover:underline"
                          >
                            {affiliate.name}
                          </Link>
                          <span className="block truncate font-mono text-meta text-muted-foreground">
                            {affiliate.code}
                          </span>
                        </TD>
                        <TD numeric className="max-sm:hidden">
                          {f.money(affiliate.revenueMinor, affiliate.currency)}
                        </TD>
                        <TD numeric className="text-foreground">
                          {f.money(affiliate.commissionMinor, affiliate.currency)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableContainer>
            )}
          </section>

          <section className="min-w-0">
            <SectionHeader
              title={t("recentConversions")}
              action={
                <Button asChild variant="ghost" size="sm">
                  <Link href={conversionsHref}>
                    {t("viewAllConversions")}
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              }
            />
            {recent.length === 0 ? (
              <EmptyState
                icon={Receipt}
                title={t("noConversions")}
                description={t("noConversionsDescription")}
                className="border-y border-border py-10"
              />
            ) : (
              <TableContainer>
                <Table>
                  <THead>
                    <tr>
                      <TH className="w-20">{tc("date")}</TH>
                      <TH>{tc("affiliate")}</TH>
                      <TH numeric>{tc("commission")}</TH>
                      <TH className="max-sm:hidden">{tc("status")}</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {recent.map((conversion) => (
                      <TR key={conversion.id}>
                        <TD className="whitespace-nowrap text-muted-foreground">
                          {instantDayLabel.format(conversion.occurredAt)}
                        </TD>
                        <TD className="max-w-0">
                          {/* The row leads to this conversion's path, click to commission. */}
                          <Link
                            href={{
                              pathname: "/[workspaceSlug]/conversions/[conversionId]",
                              params: { workspaceSlug: slug, conversionId: conversion.id },
                            }}
                            className="block truncate rounded-badge text-foreground hover:underline"
                          >
                            {conversion.affiliateName}
                          </Link>
                          <span className="block truncate font-mono text-meta text-muted-foreground">
                            {conversion.customerRef}
                          </span>
                        </TD>
                        <TD numeric className="text-foreground">
                          <span className="flex flex-col items-end gap-1">
                            {f.money(conversion.commissionMinor, conversion.currency)}
                            <StatusBadge
                              status={conversion.status}
                              label={tcs(conversion.status)}
                              className="sm:hidden"
                            />
                          </span>
                        </TD>
                        <TD className="max-sm:hidden">
                          <StatusBadge status={conversion.status} label={tcs(conversion.status)} />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableContainer>
            )}
          </section>
        </div>
      </div>
    </>
  )
}
