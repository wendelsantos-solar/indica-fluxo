import { MousePointerClick } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { AreaChart, ChartLegend } from "@/components/data-display/area-chart"
import { Metric, MetricCell, MetricGrid } from "@/components/data-display/metric"
import { EmptyState } from "@/components/feedback/empty-state"
import { PageHeader, SectionHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Term } from "@/components/ui/term"
import { getFormatters } from "@/i18n/format"
import {
  formatMoneyTotals,
  hasNonZeroTotal,
  pickPrimaryCurrency,
  toMoneyTotals,
  type MoneyTotal,
} from "@/lib/money-totals"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { getAffiliateSeries } from "@/server/repositories/analytics"
import {
  listParticipationsForUser,
  participationStats,
} from "@/server/repositories/affiliates"
import { listPayoutsForAffiliate } from "@/server/repositories/commissions"

import { DefaultReferralLink } from "../_components/default-link"
import { linkEarns, ParticipationNotice } from "../_components/participation-notice"
import { PortalList, PortalListItem } from "../_components/portal-list"

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.overview")
  return { title: t("title") }
}

/**
 * The affiliate's home, read on a phone first. It answers, in order: how much
 * is still owed to me, how much I have already received and when, and which
 * link to share. Clicks and customers come after, and a brand-new affiliate
 * sees what to do instead of a row of zeros.
 *
 * The greeting is neutral ("Olá, Marina") rather than time-of-day: the
 * affiliate has no timezone on record, and a UTC "Boa tarde" at 10:00 in São
 * Paulo reads as a bug.
 */
export default async function AffiliateOverviewPage() {
  const t = await getTranslations("portal.overview")
  const tc = await getTranslations("common.table")
  const f = await getFormatters()
  const user = await requireUser()

  const { participations, stats, series, payouts, money, currency } = await withUser(
    user.id,
    async (tx) => {
      const participations = await listParticipationsForUser(tx, user.id)
      const ids = participations.map((participation) => participation.participationId)
      const stats = await Promise.all(ids.map((id) => participationStats(tx, id)))

      // Each participation's figures are in its program's currency, and two
      // currencies are never added (DATABASE.md §4): every money figure is a
      // list of per-currency totals, led by one primary currency.
      const byCurrency = (pick: (row: (typeof stats)[number]) => number): MoneyTotal[] =>
        toMoneyTotals(
          stats.map((row, index) => ({
            currency: participations[index]!.programCurrency,
            amountMinor: pick(row),
          })),
        )
      const money = {
        pending: byCurrency((row) => row.pendingMinor),
        paid: byCurrency((row) => row.paidMinor),
        revenue: byCurrency((row) => row.revenueMinor),
        commission: byCurrency((row) => row.commissionMinor),
      }
      // The layout redirects an account with no participation, so there is one.
      const currency = pickPrimaryCurrency(
        participations[0]!.programCurrency,
        money.pending,
        money.paid,
        money.revenue,
      )

      // The chart plots one currency: only the participations paid in it.
      const series = await getAffiliateSeries(
        tx,
        ids.filter((_, index) => participations[index]!.programCurrency.toUpperCase() === currency),
      )
      const payouts = await listPayoutsForAffiliate(tx, ids)
      return { participations, stats, series, payouts, money, currency }
    },
  )

  const primary = participations[0]!

  // Counts add up across programs; money does not.
  const totals = stats.reduce(
    (acc, row) => ({ clicks: acc.clicks + row.clicks, customers: acc.customers + row.customers }),
    { clicks: 0, customers: 0 },
  )
  const pending = formatMoneyTotals(f.money, money.pending, currency)
  const paid = formatMoneyTotals(f.money, money.paid, currency)
  const revenue = formatMoneyTotals(f.money, money.revenue, currency)
  const multiCurrency = new Set(participations.map((p) => p.programCurrency.toUpperCase())).size > 1

  const lastPaidAt = payouts.reduce<Date | null>(
    (latest, payout) =>
      payout.status === "paid" && payout.paidAt && (!latest || payout.paidAt > latest)
        ? payout.paidAt
        : latest,
    null,
  )

  const hasActivity =
    totals.clicks > 0 ||
    totals.customers > 0 ||
    hasNonZeroTotal(money.commission) ||
    hasNonZeroTotal(money.paid) ||
    hasNonZeroTotal(money.pending) ||
    payouts.length > 0

  const hasChartData = series.some((point) => point.commissionMinor !== 0)

  const chartSeries = [
    {
      key: "commission",
      label: tc("commission"),
      color: "var(--chart-2)",
      values: series.map((point) => point.commissionMinor),
    },
  ]

  // Series days are UTC calendar dates (`YYYY-MM-DD`); label them the reader's way.
  const dayLabel = new Intl.DateTimeFormat(f.locale, {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  })

  // The one amber action: the first default link that exists and earns.
  const featuredId = participations.find((p) => linkEarns(p) && p.programWebsiteUrl)
    ?.participationId

  function rateLabel(participation: (typeof participations)[number]) {
    const programCurrency = participation.programCurrency
    const customValue = participation.customCommissionValue
    const rate =
      participation.customCommissionType && customValue !== null
        ? participation.customCommissionType === "fixed"
          ? t("customFixedRate", { amount: f.money(customValue, programCurrency) })
          : t("customRate", { rate: f.basisPoints(customValue) })
        : participation.commissionType === "percentage"
          ? t("percentageRate", { rate: f.basisPoints(participation.commissionValue) })
          : t("fixedRate", { amount: f.money(participation.commissionValue, programCurrency) })
    const duration =
      participation.commissionDurationMonths === null
        ? t("lifetime")
        : participation.commissionDurationMonths === 1
          ? t("firstPayment")
          : t("nMonths", { count: participation.commissionDurationMonths })
    return `${rate} · ${duration}`
  }

  const firstName = primary.affiliateName.trim().split(/\s+/)[0] ?? primary.affiliateName
  const single = participations.length === 1

  const greeting = (
    <p className="text-ui text-foreground-secondary">{t("hello", { name: firstName })}</p>
  )

  const linkSection = (
    <section>
      <SectionHeader
        title={single ? t("yourLink") : t("yourLinks")}
        count={single ? undefined : f.number(participations.length)}
        description={t("linkDescription")}
        className="mb-3"
      />
      <PortalList>
        {participations.map((participation) => (
          <PortalListItem
            key={participation.participationId}
            title={participation.programName}
            status={
              participation.status === "approved" ? undefined : (
                <StatusBadge status={participation.status} />
              )
            }
            details={rateLabel(participation)}
            className="py-4"
          >
            <div className="space-y-3">
              <ParticipationNotice
                status={participation.status}
                programStatus={participation.programStatus}
              />
              <DefaultReferralLink
                websiteUrl={participation.programWebsiteUrl}
                code={participation.code}
                prominent={participation.participationId === featuredId}
                linkToNamedLinks
              />
            </div>
          </PortalListItem>
        ))}
      </PortalList>
    </section>
  )

  return (
    <>
      <PageHeader title={t("title")} />

      <div className="space-y-10">
        {hasActivity ? (
          <>
            <section aria-label={t("earnings")} className="space-y-3">
              {greeting}
              <MetricGrid className="grid-cols-1 sm:grid-cols-2">
                <MetricCell className="space-y-1">
                  <p className="text-caption text-muted-foreground">
                    <Term definition={t("unpaidDefinition")}>{t("unpaid")}</Term>
                  </p>
                  <p className="whitespace-nowrap text-heading-sm tabular-nums text-foreground">
                    {pending.primary}
                  </p>
                  <OtherCurrencies text={pending.others && t("otherCurrencies", { amounts: pending.others })} />
                </MetricCell>
                <MetricCell className="border-t border-border-faint sm:border-t-0">
                  <Metric
                    label={t("received")}
                    value={paid.primary}
                    comparison={
                      lastPaidAt
                        ? t("lastPayout", { date: f.date(lastPaidAt) })
                        : t("noPayoutYet")
                    }
                  >
                    <OtherCurrencies text={paid.others && t("otherCurrencies", { amounts: paid.others })} />
                  </Metric>
                </MetricCell>
              </MetricGrid>
            </section>

            {linkSection}

            <section>
              <SectionHeader title={t("performance")} />
              <MetricGrid className="sm:grid-cols-4">
                <MetricCell>
                  <Metric label={tc("clicks")} value={f.number(totals.clicks)} />
                </MetricCell>
                <MetricCell>
                  <Metric label={tc("customers")} value={f.number(totals.customers)} />
                </MetricCell>
                <MetricCell className="border-t border-border-faint sm:border-t-0">
                  <Metric
                    label={tc("conversion")}
                    value={f.rate(totals.customers, totals.clicks)}
                  />
                </MetricCell>
                <MetricCell className="border-t border-border-faint sm:border-t-0">
                  <Metric label={t("revenueGenerated")} value={revenue.primary}>
                    <OtherCurrencies text={revenue.others && t("otherCurrencies", { amounts: revenue.others })} />
                  </Metric>
                </MetricCell>
              </MetricGrid>
            </section>

            {hasChartData ? (
              <Card>
                <CardHeader bordered className="flex-wrap gap-y-2">
                  <CardTitle>{t("commissionOverTime")}</CardTitle>
                  {multiCurrency ? (
                    <span className="text-meta text-muted-foreground">
                      {t("chartCurrencyNote", { currency })}
                    </span>
                  ) : null}
                  <ChartLegend series={chartSeries} />
                </CardHeader>
                <CardContent>
                  <AreaChart
                    labels={series.map((point) =>
                      dayLabel.format(new Date(`${point.date}T00:00:00Z`)),
                    )}
                    series={chartSeries}
                    currency={currency}
                    height={180}
                  />
                </CardContent>
              </Card>
            ) : null}
          </>
        ) : (
          <>
            <div className="space-y-6">
              {greeting}
              {linkSection}
            </div>
            <EmptyState
              icon={MousePointerClick}
              title={t("getStarted.title")}
              description={t("getStarted.description")}
              className="py-10"
            />
          </>
        )}
      </div>
    </>
  )
}

/**
 * The compact line under a money figure for its other currencies ("e € 120,00
 * · £ 80,00") — beside the primary figure, never added to it.
 */
function OtherCurrencies({ text }: { text: string | null }) {
  if (!text) return null
  return <p className="text-meta tabular-nums text-muted-foreground">{text}</p>
}
