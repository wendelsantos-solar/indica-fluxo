import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { AreaChart, ChartLegend } from "@/components/data-display/area-chart"
import { ReferralLinkField } from "@/components/data-display/copy-button"
import { Metric, MetricCell, MetricGrid } from "@/components/data-display/metric"
import { PageHeader, SectionHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getFormatters } from "@/i18n/format"
import { buildReferralUrl } from "@/lib/tracking/visitor"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { getAffiliateSeries } from "@/server/repositories/analytics"
import {
  listParticipationsForUser,
  participationStats,
} from "@/server/repositories/affiliates"

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.overview")
  return { title: t("title") }
}

/**
 * Bucketed in UTC, which is wrong for an affiliate in São Paulo before 09:00
 * local. Fixing it needs a timezone on the affiliate record, which does not
 * exist yet; the bucket is cosmetic, so it is not worth a schema change today.
 */
function greetingKey(now = new Date()): "morning" | "afternoon" | "evening" {
  const hour = now.getUTCHours()
  if (hour < 12) return "morning"
  if (hour < 18) return "afternoon"
  return "evening"
}

/**
 * The affiliate's home, read on a phone first: what they are owed, how their
 * links perform, and the link itself with a thumb-sized copy button. Earnings
 * and totals are one hairline strip, never a grid of tiles.
 */
export default async function AffiliateOverviewPage() {
  const t = await getTranslations("portal.overview")
  const tc = await getTranslations("common.table")
  const f = await getFormatters()
  const user = await requireUser()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://example.com"

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
      label: tc("commission"),
      color: "var(--chart-2)",
      values: series.map((point) => point.commissionMinor),
    },
  ]

  function rateLabel(participation: (typeof participations)[number]) {
    const rate =
      participation.customCommissionType && participation.customCommissionValue
        ? t("customRate", { rate: f.basisPoints(participation.customCommissionValue) })
        : participation.commissionType === "percentage"
          ? t("percentageRate", { rate: f.basisPoints(participation.commissionValue) })
          : t("fixedRate", {
              amount: f.money(participation.commissionValue, participation.programCurrency),
            })
    const duration =
      participation.commissionDurationMonths === null
        ? t("lifetime")
        : participation.commissionDurationMonths === 1
          ? t("firstPayment")
          : t("nMonths", { count: participation.commissionDurationMonths })
    return `${rate} · ${duration}`
  }

  return (
    <>
      <PageHeader title={t("title")} />

      <div className="space-y-10">
        <section className="space-y-5">
          <div className="space-y-1">
            <h2 className="text-title text-foreground">
              {t(`greeting.${greetingKey()}`, { name: primary.affiliateName.split(" ")[0] })}
            </h2>
            <p className="text-caption text-muted-foreground">{t("subtitle")}</p>
          </div>

          <MetricGrid className="sm:grid-cols-4">
            <MetricCell className="col-span-full border-b border-border-faint">
              <Metric
                label={t("unpaidEarnings")}
                value={f.money(totals.pending, currency)}
                comparison={t("paidSoFar", { amount: f.money(totals.paid, currency) })}
                size="lg"
              />
            </MetricCell>
            <MetricCell>
              <Metric label={tc("clicks")} value={f.number(totals.clicks)} />
            </MetricCell>
            <MetricCell>
              <Metric label={tc("customers")} value={f.number(totals.customers)} />
            </MetricCell>
            <MetricCell>
              <Metric label={tc("conversion")} value={f.rate(totals.customers, totals.clicks)} />
            </MetricCell>
            <MetricCell>
              <Metric label={t("revenueGenerated")} value={f.money(totals.revenue, currency)} />
            </MetricCell>
          </MetricGrid>
        </section>

        <section>
          <SectionHeader
            title={t("yourLinks")}
            count={participations.length > 1 ? f.number(participations.length) : undefined}
            className="mb-2"
          />
          <Card>
            <ul className="divide-y divide-border">
              {participations.map((participation, index) => (
                <li key={participation.participationId} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-ui font-medium text-foreground">
                        {participation.programName}
                      </p>
                      <p className="text-meta text-muted-foreground">{rateLabel(participation)}</p>
                    </div>
                    <StatusBadge status={participation.status} className="mt-0.5" />
                  </div>
                  <ReferralLinkField
                    url={buildReferralUrl(appUrl, participation.code)}
                    prominent={index === 0}
                  />
                </li>
              ))}
            </ul>
          </Card>
        </section>

        {series.length > 0 ? (
          <Card>
            <CardHeader bordered className="flex-wrap gap-y-2">
              <CardTitle>{t("commissionOverTime")}</CardTitle>
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
    </>
  )
}
