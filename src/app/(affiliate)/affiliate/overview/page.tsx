import type { Metadata } from "next"

import { AreaChart, ChartLegend } from "@/components/data-display/area-chart"
import { ReferralLinkField } from "@/components/data-display/copy-button"
import { Metric } from "@/components/data-display/metric"
import { SectionHeader } from "@/components/layout/page-header"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatBasisPoints, formatMoney, formatNumber, formatRate } from "@/lib/money"
import { buildReferralUrl } from "@/lib/tracking/visitor"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { getAffiliateSeries } from "@/server/repositories/analytics"
import {
  listParticipationsForUser,
  participationStats,
} from "@/server/repositories/affiliates"

export const metadata: Metadata = { title: "Overview" }
export const dynamic = "force-dynamic"

function greeting(now = new Date()): string {
  const hour = now.getUTCHours()
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}

export default async function AffiliateOverviewPage() {
  const user = await requireUser()

  const { participations, stats, series } = await withUser(user.id, async (tx) => {
    const participations = await listParticipationsForUser(tx, user.id)
    const stats = await Promise.all(
      participations.map((participation) =>
        participationStats(tx, participation.participationId),
      ),
    )
    const series = await getAffiliateSeries(
      tx,
      participations.map((participation) => participation.participationId),
    )
    return { participations, stats, series }
  })

  const primary = participations[0]!
  const currency = primary.programCurrency

  const totals = stats.reduce(
    (acc, row) => ({
      clicks: acc.clicks + row.clicks,
      customers: acc.customers + row.customers,
      revenue: acc.revenue + row.revenueMinor,
      commission: acc.commission + row.commissionMinor,
      paid: acc.paid + row.paidMinor,
      pending: acc.pending + row.pendingMinor,
    }),
    { clicks: 0, customers: 0, revenue: 0, commission: 0, paid: 0, pending: 0 },
  )

  const chartSeries = [
    {
      key: "commission",
      label: "Commission",
      color: "var(--chart-2)",
      values: series.map((point) => point.commissionMinor),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-subheading font-medium">
          {greeting()}, {primary.affiliateName.split(" ")[0]}.
        </h1>
        <p className="text-caption text-muted-foreground">
          Here is how your referrals are performing.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-5">
          <Metric
            label="Unpaid earnings"
            value={formatMoney(totals.pending, currency)}
            comparison={`${formatMoney(totals.paid, currency)} paid out so far`}
            size="lg"
          />
          <div className="grid grid-cols-2 gap-5 border-t border-border pt-5 sm:grid-cols-4">
            <Metric label="Clicks" value={formatNumber(totals.clicks)} />
            <Metric label="Customers" value={formatNumber(totals.customers)} />
            <Metric
              label="Conversion"
              value={formatRate(totals.customers, totals.clicks)}
            />
            <Metric
              label="Revenue generated"
              value={formatMoney(totals.revenue, currency)}
            />
          </div>
        </CardContent>
      </Card>

      <section>
        <SectionHeader title="Your referral links" />
        <div className="space-y-3">
          {participations.map((participation) => (
            <Card key={participation.participationId}>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-caption font-medium text-foreground">
                      {participation.programName}
                    </p>
                    <p className="text-meta text-muted-foreground">
                      {participation.customCommissionType && participation.customCommissionValue
                        ? `${formatBasisPoints(participation.customCommissionValue)} — your custom rate`
                        : participation.commissionType === "percentage"
                          ? `${formatBasisPoints(participation.commissionValue)} commission`
                          : `${formatMoney(participation.commissionValue, participation.programCurrency)} per conversion`}
                      {participation.commissionDurationMonths === null
                        ? " · lifetime"
                        : participation.commissionDurationMonths === 1
                          ? " · first payment"
                          : ` · ${participation.commissionDurationMonths} months`}
                    </p>
                  </div>
                  <Badge tone={participation.status === "approved" ? "success" : "warning"}>
                    {participation.status}
                  </Badge>
                </div>

                <ReferralLinkField
                  url={buildReferralUrl(
                    process.env.NEXT_PUBLIC_APP_URL ?? "https://example.com",
                    participation.code,
                  )}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {series.length > 0 ? (
        <Card>
          <CardHeader bordered>
            <CardTitle>Commission over time</CardTitle>
            <ChartLegend series={chartSeries} />
          </CardHeader>
          <CardContent>
            <AreaChart
              labels={series.map((point) => point.date.slice(5))}
              series={chartSeries}
              currency={currency}
              height={180}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
