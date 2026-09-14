import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { AreaChart, ChartLegend } from "@/components/data-display/area-chart"
import { getFormatters } from "@/i18n/format"
import { ReferralLinkField } from "@/components/data-display/copy-button"
import { Metric } from "@/components/data-display/metric"
import { SectionHeader } from "@/components/layout/page-header"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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

export default async function AffiliateOverviewPage() {
  const t = await getTranslations("portal.overview")
  const tc = await getTranslations("common.table")
  const ts = await getTranslations("status")
  const f = await getFormatters()
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
      label: tc("commission"),
      color: "var(--chart-2)",
      values: series.map((point) => point.commissionMinor),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-subheading font-medium">
          {t(`greeting.${greetingKey()}`, { name: primary.affiliateName.split(" ")[0] })}
        </h1>
        <p className="text-caption text-muted-foreground">
          {t("subtitle")}
        </p>
      </div>

      <Card>
        <CardContent className="space-y-5">
          <Metric
            label={t("unpaidEarnings")}
            value={f.money(totals.pending, currency)}
            comparison={t("paidSoFar", { amount: f.money(totals.paid, currency) })}
            size="lg"
          />
          <div className="grid grid-cols-2 gap-5 border-t border-border pt-5 sm:grid-cols-4">
            <Metric label={tc("clicks")} value={f.number(totals.clicks)} />
            <Metric label={tc("customers")} value={f.number(totals.customers)} />
            <Metric
              label={tc("conversion")}
              value={f.rate(totals.customers, totals.clicks)}
            />
            <Metric
              label={t("revenueGenerated")}
              value={f.money(totals.revenue, currency)}
            />
          </div>
        </CardContent>
      </Card>

      <section>
        <SectionHeader title={t("yourLinks")} />
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
                        ? t("customRate", {
                            rate: f.basisPoints(participation.customCommissionValue),
                          })
                        : participation.commissionType === "percentage"
                          ? t("percentageRate", {
                              rate: f.basisPoints(participation.commissionValue),
                            })
                          : t("fixedRate", {
                              amount: f.money(
                                participation.commissionValue,
                                participation.programCurrency,
                              ),
                            })}
                      {participation.commissionDurationMonths === null
                        ? ` · ${t("lifetime")}`
                        : participation.commissionDurationMonths === 1
                          ? ` · ${t("firstPayment")}`
                          : ` · ${t("nMonths", { count: participation.commissionDurationMonths })}`}
                    </p>
                  </div>
                  <Badge tone={participation.status === "approved" ? "success" : "warning"}>
                    {ts(participation.status)}
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
  )
}
