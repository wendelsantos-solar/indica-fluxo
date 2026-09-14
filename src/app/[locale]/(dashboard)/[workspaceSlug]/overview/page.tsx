import { ArrowRight, Coins } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { Suspense } from "react"

import { Link } from "@/i18n/navigation"

import { AreaChart, ChartLegend } from "@/components/data-display/area-chart"
import { getFormatters } from "@/i18n/format"
import { Funnel } from "@/components/data-display/funnel"
import { Metric, MetricCell, MetricGrid } from "@/components/data-display/metric"
import { PageHeader, SectionHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { ActivationChecklist, ActivationReminder } from "@/features/onboarding/activation-checklist"
import { activationSignals, getActivation } from "@/features/onboarding/activation"
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
import { listIntegrations } from "@/server/services/integrations"
import { getWorkspaceForUser } from "@/server/services/workspaces"

import { OverviewSkeleton } from "./overview-skeleton"

export const dynamic = "force-dynamic"

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

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <Suspense fallback={<OverviewSkeleton />}>
        <OverviewContent slug={workspaceSlug} welcome={welcome === "1"} />
      </Suspense>
    </>
  )
}

async function OverviewContent({ slug, welcome }: { slug: string; welcome: boolean }) {
  const t = await getTranslations("dashboard.overview")
  const tc = await getTranslations("common.table")
  const f = await getFormatters()
  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, slug)

  const [overview, series, funnel, topAffiliates, recent, programs, integrations, affiliates] =
    await withUser(user.id, (tx) =>
      Promise.all([
        getDashboardOverview(tx, workspace.id),
        getRevenueSeries(tx, workspace.id),
        getConversionFunnel(tx, workspace.id),
        getTopAffiliates(tx, workspace.id),
        getRecentConversions(tx, workspace.id),
        // Activation checklist: existing read functions only, see
        // features/onboarding/activation.ts for how each step is derived.
        listPrograms(tx, workspace.id),
        listIntegrations(tx, workspace.id),
        listAffiliates(tx, { workspaceId: workspace.id, limit: 1 }),
      ]),
    )

  const activation = getActivation(
    activationSignals({ programs, integrations, affiliateTotal: affiliates.total }),
  )

  const delta =
    overview.revenuePreviousMinor > 0
      ? ((overview.revenueMinor - overview.revenuePreviousMinor) /
          overview.revenuePreviousMinor) *
        100
      : null

  const chartSeries = [
    {
      key: "revenue",
      label: t("legendRevenue"),
      color: "var(--chart-1)",
      values: series.map((point) => point.revenueMinor),
    },
    {
      key: "commission",
      label: t("legendCommission"),
      color: "var(--chart-2)",
      values: series.map((point) => point.commissionMinor),
    },
  ]

  const hasData = overview.clicks > 0 || overview.revenueMinor !== 0

  if (!hasData) {
    return (
      <ActivationChecklist
        workspaceSlug={slug}
        activation={activation}
        programs={programs}
        welcome={welcome}
      />
    )
  }

  // Axis and tooltip dates in the reader's convention ("14 set."), never ISO.
  const dayLabel = new Intl.DateTimeFormat(f.locale, { day: "numeric", month: "short", timeZone: "UTC" })
  const labels = series.map((point) => dayLabel.format(new Date(`${point.date}T00:00:00Z`)))
  const peak = series.reduce<(typeof series)[number] | null>(
    (best, point) => (best === null || point.revenueMinor > best.revenueMinor ? point : best),
    null,
  )
  const chartSummary = t("chartSummary", {
    start: labels[0] ?? "",
    end: labels[labels.length - 1] ?? "",
    revenue: f.money(overview.revenueMinor, overview.currency),
    commission: f.money(overview.commissionMinor, overview.currency),
    peakDay: peak ? dayLabel.format(new Date(`${peak.date}T00:00:00Z`)) : "",
    peakRevenue: f.money(peak?.revenueMinor ?? 0, overview.currency),
  })

  return (
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
              value={f.money(overview.revenueMinor, overview.currency)}
              delta={delta}
              comparison={t("metrics.comparison")}
              size="lg"
            />
          </MetricCell>
          <MetricCell>
            <Metric
              label={t("metrics.commissions")}
              value={f.money(overview.commissionMinor, overview.currency)}
              comparison={t("metrics.netRevenueAfter", {
                amount: f.money(overview.netRevenueMinor, overview.currency),
              })}
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
            <Metric label={t("metrics.activeAffiliates")} value={f.number(overview.activeAffiliates)} />
          </MetricCell>
        </MetricGrid>

        {overview.availableCommissionMinor > 0 ? (
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-control border border-border text-muted-foreground">
                  <Coins className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-caption font-medium text-foreground">
                    {t("readyToPay", {
                      amount: f.money(overview.availableCommissionMinor, overview.currency),
                    })}
                  </p>
                  {overview.pendingCommissionMinor > 0 ? (
                    <p className="text-meta text-muted-foreground">
                      {t("stillOnHold", {
                        amount: f.money(overview.pendingCommissionMinor, overview.currency),
                      })}
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
            <ChartLegend series={chartSeries} />
          </CardHeader>
          <CardContent>
            <AreaChart labels={labels} series={chartSeries} currency={overview.currency} summary={chartSummary} />
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader bordered>
            <CardTitle>{t("conversionFunnel")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Funnel steps={funnel} />
          </CardContent>
        </Card>
      </div>

      {/* 3 — Who and what is behind the numbers. */}
      <div className="grid gap-x-8 gap-y-10 lg:grid-cols-2">
        <section className="min-w-0">
          <SectionHeader
            title={t("topAffiliates")}
            action={
              <Button asChild variant="ghost" size="sm">
                <Link href={{ pathname: "/[workspaceSlug]/affiliates", params: { workspaceSlug: slug } }}>
                  {t("viewAllAffiliates")}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            }
          />
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
                {topAffiliates.length === 0 ? (
                  <TR>
                    <TD colSpan={3} className="text-center text-muted-foreground">
                      {t("noCommissions")}
                    </TD>
                  </TR>
                ) : (
                  topAffiliates.map((affiliate) => (
                    <TR key={affiliate.participationId}>
                      <TD className="max-w-0">
                        <span className="block truncate text-foreground">{affiliate.name}</span>
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
                  ))
                )}
              </TBody>
            </Table>
          </TableContainer>
        </section>

        <section className="min-w-0">
          <SectionHeader
            title={t("recentConversions")}
            action={
              <Button asChild variant="ghost" size="sm">
                <Link href={{ pathname: "/[workspaceSlug]/conversions", params: { workspaceSlug: slug } }}>
                  {t("viewAllConversions")}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            }
          />
          <TableContainer>
            <Table>
              <THead>
                <tr>
                  <TH>{tc("affiliate")}</TH>
                  <TH className="max-sm:hidden">{tc("customer")}</TH>
                  <TH numeric>{tc("commission")}</TH>
                  <TH className="max-sm:hidden">{tc("status")}</TH>
                </tr>
              </THead>
              <TBody>
                {recent.length === 0 ? (
                  <TR>
                    <TD colSpan={4} className="text-center text-muted-foreground">
                      {t("noConversions")}
                    </TD>
                  </TR>
                ) : (
                  recent.map((conversion) => (
                    <TR key={conversion.id}>
                      <TD className="max-w-0">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-foreground">{conversion.affiliateName}</span>
                          <StatusBadge status={conversion.status} className="sm:hidden" />
                        </span>
                        <span className="block truncate font-mono text-meta text-muted-foreground sm:hidden">
                          {conversion.customerRef}
                        </span>
                      </TD>
                      <TD mono className="max-w-40 truncate max-sm:hidden">
                        {conversion.customerRef}
                      </TD>
                      <TD numeric className="text-foreground">
                        {f.money(conversion.commissionMinor, conversion.currency)}
                      </TD>
                      <TD className="max-sm:hidden">
                        <StatusBadge status={conversion.status} />
                      </TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </TableContainer>
        </section>
      </div>
    </div>
  )
}
