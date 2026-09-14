import { ArrowRight, Coins, Users } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { Suspense } from "react"

import { Link } from "@/i18n/navigation"

import { AreaChart, ChartLegend } from "@/components/data-display/area-chart"
import { getFormatters } from "@/i18n/format"
import { Funnel } from "@/components/data-display/funnel"
import { Metric, MetricCell, MetricGrid } from "@/components/data-display/metric"
import { EmptyState } from "@/components/feedback/empty-state"
import { PageHeader, SectionHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MetricSkeleton, TableSkeleton } from "@/components/ui/skeleton"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import {
  getConversionFunnel,
  getDashboardOverview,
  getRecentConversions,
  getRevenueSeries,
  getTopAffiliates,
} from "@/server/repositories/analytics"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/[workspaceSlug]/overview">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.overview" })
  return { title: t("title") }
}

export default async function OverviewPage({ params }: PageProps<"/[locale]/[workspaceSlug]/overview">) {
  const { workspaceSlug } = await params
  const t = await getTranslations("dashboard.overview")

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <Suspense fallback={<OverviewSkeleton />}>
        <OverviewContent slug={workspaceSlug} />
      </Suspense>
    </>
  )
}

async function OverviewContent({ slug }: { slug: string }) {
  const t = await getTranslations("dashboard.overview")
  const tc = await getTranslations("common.table")
  const f = await getFormatters()
  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, slug)

  const [overview, series, funnel, topAffiliates, recent] = await withUser(user.id, (tx) =>
    Promise.all([
      getDashboardOverview(tx, workspace.id),
      getRevenueSeries(tx, workspace.id),
      getConversionFunnel(tx, workspace.id),
      getTopAffiliates(tx, workspace.id),
      getRecentConversions(tx, workspace.id),
    ]),
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
      <Card>
        <EmptyState
          icon={Users}
          title={t("empty.title")}
          description={t("empty.description")}
          action={
            <Button asChild variant="primary">
              <Link href={{ pathname: "/[workspaceSlug]/programs/new", params: { workspaceSlug: slug } }}>{t("empty.action")}</Link>
            </Button>
          }
        />
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-end justify-between gap-6">
          <Metric
            label={t("metrics.revenue")}
            value={f.money(overview.revenueMinor, overview.currency)}
            delta={delta}
            comparison={t("metrics.comparison")}
            size="lg"
          />
          <div className="flex flex-wrap gap-8">
            <Metric
              label={t("metrics.commissions")}
              value={f.money(overview.commissionMinor, overview.currency)}
            />
            <Metric
              label={t("metrics.netRevenue")}
              value={f.money(overview.netRevenueMinor, overview.currency)}
            />
          </div>
        </CardContent>
      </Card>

      <MetricGrid>
        <MetricCell>
          <Metric label={t("metrics.activeAffiliates")} value={f.number(overview.activeAffiliates)} />
        </MetricCell>
        <MetricCell>
          <Metric label={t("metrics.customers")} value={f.number(overview.customersAcquired)} />
        </MetricCell>
        <MetricCell>
          <Metric
            label={t("metrics.conversionRate")}
            value={f.rate(overview.customersAcquired, overview.clicks)}
            comparison={t("metrics.clicks", { count: f.number(overview.clicks) })}
          />
        </MetricCell>
      </MetricGrid>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader bordered>
            <CardTitle>{t("revenueOverTime")}</CardTitle>
            <ChartLegend series={chartSeries} />
          </CardHeader>
          <CardContent>
            <AreaChart
              labels={series.map((point) => point.date.slice(5))}
              series={chartSeries}
              currency={overview.currency}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader bordered>
            <CardTitle>{t("conversionFunnel")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Funnel steps={funnel} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <SectionHeader
            title={t("topAffiliates")}
            action={
              <Button asChild variant="ghost" size="sm">
                <Link href={{ pathname: "/[workspaceSlug]/affiliates", params: { workspaceSlug: slug } }}>
                  {t("viewAll")}
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
                  <TH numeric>{tc("revenue")}</TH>
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
                      <TD>
                        <span className="block text-foreground">{affiliate.name}</span>
                        <span className="font-mono text-label text-muted-foreground">
                          {affiliate.code}
                        </span>
                      </TD>
                      <TD numeric>{f.money(affiliate.revenueMinor, affiliate.currency)}</TD>
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

        <section>
          <SectionHeader
            title={t("recentConversions")}
            action={
              <Button asChild variant="ghost" size="sm">
                <Link href={{ pathname: "/[workspaceSlug]/conversions", params: { workspaceSlug: slug } }}>
                  {t("viewAll")}
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
                  <TH>{tc("customer")}</TH>
                  <TH numeric>{tc("commission")}</TH>
                </tr>
              </THead>
              <TBody>
                {recent.length === 0 ? (
                  <TR>
                    <TD colSpan={3} className="text-center text-muted-foreground">
                      {t("noConversions")}
                    </TD>
                  </TR>
                ) : (
                  recent.map((conversion) => (
                    <TR key={conversion.id}>
                      <TD className="text-foreground">{conversion.affiliateName}</TD>
                      <TD mono>{conversion.customerRef}</TD>
                      <TD numeric>
                        <span className="flex items-center justify-end gap-2">
                          {f.money(conversion.commissionMinor, conversion.currency)}
                          <StatusBadge status={conversion.status} />
                        </span>
                      </TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </TableContainer>
        </section>
      </div>

      {overview.availableCommissionMinor > 0 ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-control bg-surface-2">
                <Coins className="size-4 text-muted-foreground" aria-hidden="true" />
              </span>
              <div>
                <p className="text-caption font-medium">
                  {t("readyToPay", {
                    amount: f.money(overview.availableCommissionMinor, overview.currency),
                  })}
                </p>
                <p className="text-meta text-muted-foreground">
                  {t("stillOnHold", {
                    amount: f.money(overview.pendingCommissionMinor, overview.currency),
                  })}
                </p>
              </div>
            </div>
            <Button asChild variant="primary">
              <Link href={{ pathname: "/[workspaceSlug]/payouts", params: { workspaceSlug: slug } }}>{t("reviewPayouts")}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-px overflow-hidden rounded-panel border border-border bg-border sm:grid-cols-3">
        <MetricSkeleton />
        <MetricSkeleton />
        <MetricSkeleton />
      </div>
      <TableSkeleton rows={5} columns={3} />
    </div>
  )
}
