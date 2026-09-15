import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { AreaChart, ChartLegend } from "@/components/data-display/area-chart"
import { Metric, MetricCell, MetricGrid } from "@/components/data-display/metric"
import { PageHeader, SectionHeader } from "@/components/layout/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EnvironmentBadge } from "@/features/programs/environment-badge"
import { getFormatters } from "@/i18n/format"
import {
  formatMoneyTotals,
  formatMoneyTotalsInline,
  hasNonZeroTotal,
  pickPrimaryCurrency,
  toMoneyTotals,
  type MoneyTotal,
} from "@/lib/money-totals"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { getAffiliateSeries } from "@/server/repositories/analytics"
import { listPayoutsForAffiliate } from "@/server/repositories/commissions"
import { listPortalParticipations, portalParticipationStats } from "@/server/repositories/portal"

import { receivable as splitReceivable } from "../_components/balance"
import { DefaultReferralLink } from "../_components/default-link"
import { linkEarns, ParticipationNotice } from "../_components/participation-notice"
import { ParticipationBadge } from "../_components/portal-badges"
import { PortalList, PortalListItem } from "../_components/portal-list"

export const dynamic = "force-dynamic"

/** Days listed under the chart — the chart's tap- and screen-reader-friendly twin. */
const CHART_DAYS_LISTED = 7

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.overview")
  return { title: t("title") }
}

/**
 * The affiliate's home, read on a phone first. It answers, in order: how much
 * is still owed to me and when it can be paid, how much I have already
 * received, and which link to share. Clicks and customers come after, and a
 * brand-new affiliate sees what to do before the link, not after it.
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
  const now = new Date()

  const { participations, stats, series, payouts, money, currency, balance, test } = await withUser(
    user.id,
    async (tx) => {
      const participations = await listPortalParticipations(tx, user.id)
      const ids = participations.map((participation) => participation.participationId)
      // One statement for every program, not one per participation.
      const statsRows = await portalParticipationStats(tx, ids)
      const byId = new Map(statsRows.map((row) => [row.participationId, row]))
      const allStats = participations.map((participation) => ({
        currency: participation.programCurrency,
        environment: participation.programEnvironment,
        ...(byId.get(participation.participationId) ?? {
          participationId: participation.participationId,
          clicks: 0,
          customers: 0,
          revenueMinor: 0,
          commissionMinor: 0,
          paidMinor: 0,
          availableMinor: 0,
          holdMinor: 0,
          approvedMinor: 0,
          nextReleaseAt: null,
        }),
      }))

      // Test programs never add to what the affiliate is owed or has
      // received: a test commission is not money (docs/PLANS.md §2). Every
      // balance and total below is live; test figures get their own card.
      const stats = allStats.filter((row) => row.environment === "live")
      const testStats = allStats.filter((row) => row.environment === "test")

      // Each participation's figures are in its program's currency, and two
      // currencies are never added (DATABASE.md §4): every money figure is a
      // list of per-currency totals, led by one primary currency.
      const byCurrency = (
        rows: typeof allStats,
        pick: (row: (typeof allStats)[number]) => number,
      ): MoneyTotal[] => toMoneyTotals(rows.map((row) => ({ currency: row.currency, amountMinor: pick(row) })))
      const balance = splitReceivable(stats, now)
      const money = {
        paid: byCurrency(stats, (row) => row.paidMinor),
        revenue: byCurrency(stats, (row) => row.revenueMinor),
        commission: byCurrency(stats, (row) => row.commissionMinor),
      }
      const test = {
        count: testStats.length,
        clicks: testStats.reduce((sum, row) => sum + row.clicks, 0),
        commission: byCurrency(testStats, (row) => row.commissionMinor),
        unpaid: splitReceivable(testStats, now).total,
      }
      // The layout redirects an account with no participation, so there is one.
      const currency = pickPrimaryCurrency(
        participations[0]!.programCurrency,
        balance.total,
        money.paid,
        money.revenue,
      )

      // The chart plots one currency of live money: only the live participations paid in it.
      const series = await getAffiliateSeries(
        tx,
        participations
          .filter((p) => p.programEnvironment === "live" && p.programCurrency.toUpperCase() === currency)
          .map((p) => p.participationId),
      )
      const payouts = (await listPayoutsForAffiliate(tx, ids)).filter((payout) => payout.environment === "live")
      return { participations, stats, series, payouts, money, currency, balance, test }
    },
  )

  // Counts add up across programs; money does not.
  const totals = stats.reduce(
    (acc, row) => ({ clicks: acc.clicks + row.clicks, customers: acc.customers + row.customers }),
    { clicks: 0, customers: 0 },
  )
  const owed = formatMoneyTotals(f.money, balance.total, currency)
  const paid = formatMoneyTotals(f.money, money.paid, currency)
  const revenue = formatMoneyTotals(f.money, money.revenue, currency)
  const inline = (list: MoneyTotal[]) => formatMoneyTotalsInline(f.money, list, currency)
  const multiCurrency =
    new Set(participations.filter((p) => p.programEnvironment === "live").map((p) => p.programCurrency.toUpperCase()))
      .size > 1

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
    hasNonZeroTotal(balance.total) ||
    payouts.length > 0 ||
    test.clicks > 0 ||
    hasNonZeroTotal(test.commission)

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
  const allEarningDays = series.filter((point) => point.commissionMinor !== 0)
  const earningDays = [...allEarningDays].reverse().slice(0, CHART_DAYS_LISTED)
  const chartTotal = series.reduce((sum, point) => sum + point.commissionMinor, 0)

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

  // The person's own profile name; the name a program owner recorded is only
  // a fallback when every program has the same one.
  const recordedNames = [...new Set(participations.map((p) => p.affiliateName.trim()).filter(Boolean))]
  const displayName = user.name ?? (recordedNames.length === 1 ? recordedNames[0]! : null)
  const firstName = displayName ? (displayName.split(/\s+/)[0] ?? displayName) : null
  const single = participations.length === 1

  const greeting = (
    <p className="text-ui text-foreground-secondary">
      {firstName ? t("hello", { name: firstName }) : t("helloNoName")}
    </p>
  )

  const linkList = (
    <PortalList>
      {participations.map((participation) => (
        <PortalListItem
          key={participation.participationId}
          title={participation.programName}
          status={
            participation.status === "approved" && participation.programEnvironment === "live" ? undefined : (
              <span className="flex items-center gap-1.5">
                {participation.programEnvironment === "test" ? <EnvironmentBadge environment="test" /> : null}
                {participation.status === "approved" ? null : <ParticipationBadge status={participation.status} />}
              </span>
            )
          }
          details={rateLabel(participation)}
          className="py-4"
        >
          <div className="space-y-3">
            {participation.programDescription ? (
              <p className="max-w-[68ch] text-pretty text-caption text-muted-foreground">
                {participation.programDescription}
              </p>
            ) : null}
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
                  <p className="text-caption text-muted-foreground">{t("unpaid")}</p>
                  <p className="whitespace-nowrap text-heading-sm tabular-nums text-foreground">
                    {owed.primary}
                  </p>
                  <OtherCurrencies text={owed.others && t("otherCurrencies", { amounts: owed.others })} />
                  {hasNonZeroTotal(balance.total) ? (
                    <dl className="mt-3 divide-y divide-border-faint border-t border-border-faint text-caption">
                      <BalanceRow label={t("balance.available")} value={inline(balance.available)} />
                      <BalanceRow
                        label={t("balance.onHold")}
                        value={inline(balance.hold)}
                        note={
                          balance.nextReleaseAt
                            ? t("balance.nextRelease", { date: f.date(balance.nextReleaseAt) })
                            : undefined
                        }
                      />
                      {hasNonZeroTotal(balance.approved) ? (
                        <BalanceRow
                          label={t("balance.inBatch")}
                          value={inline(balance.approved)}
                          note={t("balance.inBatchNote")}
                        />
                      ) : null}
                    </dl>
                  ) : null}
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
              {test.count > 0 && (test.clicks > 0 || hasNonZeroTotal(test.commission)) ? (
                <Card>
                  <CardHeader bordered className="flex-wrap gap-y-2">
                    <CardTitle>{t("test.title")}</CardTitle>
                    <EnvironmentBadge environment="test" />
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="max-w-[68ch] text-pretty text-caption text-muted-foreground">
                      {t("test.description")}
                    </p>
                    <dl className="divide-y divide-border-faint border-y border-border-faint text-caption">
                      <BalanceRow label={tc("clicks")} value={f.number(test.clicks)} />
                      <BalanceRow label={t("test.commission")} value={inline(test.commission)} />
                      <BalanceRow label={t("test.unpaid")} value={inline(test.unpaid)} />
                    </dl>
                  </CardContent>
                </Card>
              ) : null}
            </section>

            <section>
              <SectionHeader
                title={single ? t("yourLink") : t("yourLinks")}
                count={single ? undefined : f.number(participations.length)}
                description={t("linkDescription")}
                className="mb-3"
              />
              {linkList}
            </section>

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
                    summary={t("chartSummary", {
                      amount: f.money(chartTotal, currency),
                      days: allEarningDays.length,
                    })}
                    height={180}
                  />
                  {/* The chart's values without hovering: listed on phones,
                      where there is no hover, and for screen readers. */}
                  <div className="mt-4 md:sr-only">
                    <p className="mb-1 text-meta text-muted-foreground">{t("chartDaysTitle")}</p>
                    <ul className="divide-y divide-border-faint border-y border-border-faint">
                      {earningDays.map((point) => (
                        <li
                          key={point.date}
                          className="flex items-center justify-between gap-3 px-1 py-2 text-caption"
                        >
                          <span className="text-muted-foreground">
                            {dayLabel.format(new Date(`${point.date}T00:00:00Z`))}
                          </span>
                          <span className="tabular-nums text-foreground">
                            {f.money(point.commissionMinor, currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </>
        ) : (
          <div className="space-y-4">
            {greeting}
            {/* The guidance comes before the link it is about. */}
            <section>
              <SectionHeader
                title={t("getStarted.title")}
                description={t("linkDescription")}
                className="mb-3"
              />
              {linkList}
              <p className="mt-3 max-w-[68ch] text-pretty text-caption text-muted-foreground">
                {t("getStarted.description")}
              </p>
            </section>
          </div>
        )}
      </div>
    </>
  )
}

/** One part of "A receber": what it is, how much, and — when it applies — when it changes. */
function BalanceRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="whitespace-nowrap text-right tabular-nums text-foreground">{value}</dd>
      {note ? <dd className="col-span-2 mt-0.5 text-meta text-muted-foreground">{note}</dd> : null}
    </div>
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
