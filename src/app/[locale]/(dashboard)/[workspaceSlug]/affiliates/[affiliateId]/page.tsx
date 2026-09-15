import { ArrowRight, Coins, Link2, Receipt } from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import type * as React from "react"

import { Link } from "@/i18n/navigation"

import { Metric, MetricCell, MetricGrid } from "@/components/data-display/metric"
import { EmptyState } from "@/components/feedback/empty-state"
import { PageHeader, SectionHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import {
  ApproveParticipationButton,
  AffiliateRowActions,
} from "@/features/affiliates/affiliate-row-actions"
import { describeRuleApplied } from "@/features/conversions/rule-applied"
import { getFormatters } from "@/i18n/format"
import { parseUuidParam } from "@/lib/list-params"
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
import { getAffiliateDetail, listLinksForAffiliate } from "@/server/repositories/affiliates"
import { listConversions } from "@/server/repositories/analytics"
import {
  commissionTotalsByStatus,
  listCommissions,
  type CommissionStatus,
} from "@/server/repositories/commissions"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const dynamic = "force-dynamic"

const RECENT_LIMIT = 5

/** The commissions an affiliate has earned: everything but reversed and rejected. */
const EARNED: readonly CommissionStatus[] = ["pending", "available", "approved", "paid"]
const BREAKDOWN: readonly CommissionStatus[] = ["pending", "available", "approved", "paid", "reversed"]

// Typed by hand rather than with the generated `PageProps<…>`, so the page does
// not depend on route type generation having run for this new segment.
interface AffiliateDetailPageProps {
  params: Promise<{ locale: string; workspaceSlug: string; affiliateId: string }>
}

export async function generateMetadata({ params }: AffiliateDetailPageProps): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.affiliate" })
  return { title: t("title") }
}

export default async function AffiliateDetailPage({ params }: AffiliateDetailPageProps) {
  const { workspaceSlug, affiliateId: rawId } = await params
  const affiliateId = parseUuidParam(rawId)
  if (!affiliateId) notFound()

  const t = await getTranslations("dashboard.affiliate")
  const tl = await getTranslations("dashboard.affiliates")
  const tc = await getTranslations("common.table")
  const tm = await getTranslations("common.money")
  const tcs = await getTranslations("dashboard.commissions.statusLabel")
  const tconv = await getTranslations("dashboard.conversions")

  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)
  const f = await getFormatters(workspace.timezone)
  const trule = await getTranslations("common.rule")

  // RLS hides another workspace's affiliate, and the query scopes to this
  // workspace as well, so an unknown and a foreign id both read as not found.
  const data = await withUser(user.id, async (tx) => {
    const affiliate = await getAffiliateDetail(tx, workspace.id, affiliateId)
    if (!affiliate) return null
    return {
      affiliate,
      byStatus: await commissionTotalsByStatus(tx, { workspaceId: workspace.id, affiliateId }),
      links: await listLinksForAffiliate(tx, workspace.id, affiliateId),
      conversions: await listConversions(tx, { workspaceId: workspace.id, affiliateId, limit: RECENT_LIMIT }),
      commissions: await listCommissions(tx, { workspaceId: workspace.id, affiliateId, limit: RECENT_LIMIT }),
    }
  })
  if (!data) notFound()
  const { affiliate, byStatus, links, conversions, commissions } = data

  const earned = toMoneyTotals(EARNED.flatMap((status) => byStatus[status]))
  const currency = pickPrimaryCurrency(workspace.defaultCurrency, earned, affiliate.revenue)
  const money = (totals: MoneyTotal[]) => formatMoneyTotals(f.money, totals, currency)
  const others = (formatted: { others: string | null }) =>
    formatted.others ? tm("otherCurrencies", { amounts: formatted.others }) : null

  const clicks = affiliate.participations.reduce((sum, row) => sum + row.clicks, 0)
  const customers = affiliate.participations.reduce((sum, row) => sum + row.customers, 0)
  const revenue = money(affiliate.revenue)
  const earnedFormatted = money(earned)

  const canManage = workspace.role !== "member"
  const listHref = { pathname: "/[workspaceSlug]/affiliates", params: { workspaceSlug } } as const
  const conversionsHref = {
    pathname: "/[workspaceSlug]/conversions",
    params: { workspaceSlug },
    query: { affiliate: affiliate.id },
  } as const
  const commissionsHref = (status?: CommissionStatus) =>
    ({
      pathname: "/[workspaceSlug]/commissions",
      params: { workspaceSlug },
      query: status ? { affiliate: affiliate.id, status } : { affiliate: affiliate.id },
    }) as const

  const describeRate = (type: "percentage" | "fixed", value: number, rateCurrency: string) =>
    type === "percentage" ? f.basisPoints(value) : t("fixedRate", { amount: f.money(value, rateCurrency) })

  const breakdown = BREAKDOWN.filter((status) => hasNonZeroTotal(byStatus[status]))

  return (
    <>
      <PageHeader
        breadcrumb={[
          <Link key="affiliates" href={listHref}>
            {tl("title")}
          </Link>,
        ]}
        title={affiliate.name}
        meta={<StatusBadge status={affiliate.status} />}
      />

      {/* The shell caps direct children at the content width; the inner
          wrapper narrows to the detail width, like every other detail page. */}
      <div>
        <div className="max-w-detail space-y-10">
          {/* Identity — the name is already the last crumb of the bar above. */}
          <div>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-muted-foreground">
              <span className="break-all">{affiliate.email}</span>
              {affiliate.companyName ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{affiliate.companyName}</span>
                </>
              ) : null}
              <span aria-hidden="true">·</span>
              <span>{t("since", { date: f.date(affiliate.createdAt) })}</span>
            </p>
          </div>

          {/* All-time performance, per currency — never summed across currencies. */}
          <section className="space-y-2">
            <SectionHeader title={t("metrics.title")} description={t("metrics.scope")} />
            <MetricGrid className="sm:grid-cols-2 lg:grid-cols-4">
              <MetricCell>
                <Metric label={t("metrics.clicks")} value={f.number(clicks)} />
              </MetricCell>
              <MetricCell>
                <Metric
                  label={t("metrics.customers")}
                  value={f.number(customers)}
                  comparison={t("metrics.conversionRate", { rate: f.rate(customers, clicks) })}
                />
              </MetricCell>
              <MetricCell>
                <Metric label={t("metrics.revenue")} value={revenue.primary} secondaryValue={others(revenue)} />
              </MetricCell>
              <MetricCell>
                <Metric
                  label={t("metrics.commissions")}
                  value={earnedFormatted.primary}
                  secondaryValue={others(earnedFormatted)}
                  comparison={t("metrics.commissionsScope")}
                />
              </MetricCell>
            </MetricGrid>

            {breakdown.length > 0 ? (
              <dl className="grid gap-x-6 gap-y-1 pt-2 sm:grid-cols-2">
                {breakdown.map((status) => (
                  <div
                    key={status}
                    className="flex min-h-9 items-center justify-between gap-3 border-b border-border-faint"
                  >
                    <dt>
                      <StatusBadge status={status} label={tcs(status)} />
                    </dt>
                    <dd className="text-right">
                      <Link
                        href={commissionsHref(status)}
                        className="rounded-badge tabular-nums text-foreground hover:underline"
                      >
                        {formatMoneyTotalsInline(f.money, byStatus[status], currency, {
                          signDisplay: status === "reversed" ? "always" : "auto",
                        })}
                      </Link>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </section>

          {/* Programs */}
          <section>
            <SectionHeader title={t("programs.title")} count={f.number(affiliate.participations.length)} />
            {affiliate.participations.length === 0 ? (
              <p className="border-y border-border py-6 text-center text-caption text-muted-foreground">
                {t("programs.empty")}
              </p>
            ) : (
              <TableContainer scrollable>
                <Table className="min-w-2xl">
                  <THead>
                    <tr>
                      <TH>{tc("program")}</TH>
                      <TH>{tc("status")}</TH>
                      <TH>{tc("code")}</TH>
                      <TH numeric>{tc("rate")}</TH>
                      <TH numeric>{tc("clicks")}</TH>
                      <TH numeric>{tc("customers")}</TH>
                      {canManage ? (
                        <TH className="w-px">
                          <span className="sr-only">{tc("actions")}</span>
                        </TH>
                      ) : null}
                    </tr>
                  </THead>
                  <TBody>
                    {affiliate.participations.map((row) => {
                      const custom =
                        row.customCommissionType && row.customCommissionValue !== null
                          ? { type: row.customCommissionType, value: row.customCommissionValue }
                          : null
                      const programRate = { type: row.programCommissionType, value: row.programCommissionValue }
                      return (
                        <TR key={row.participationId}>
                          <TD className="whitespace-nowrap">
                            <Link
                              href={{
                                pathname: "/[workspaceSlug]/programs/[programSlug]",
                                params: { workspaceSlug, programSlug: row.programSlug },
                              }}
                              className="rounded-badge text-foreground hover:underline"
                            >
                              {row.programName}
                            </Link>
                          </TD>
                          <TD>
                            <StatusBadge status={row.status} label={tl(`status.${row.status}`)} />
                          </TD>
                          <TD mono>{row.code}</TD>
                          <TD numeric>
                            {custom ? (
                              <>
                                {describeRate(custom.type, custom.value, row.currency)}
                                <span className="block text-meta text-muted-foreground">{t("programs.customRate")}</span>
                              </>
                            ) : (
                              describeRate(programRate.type, programRate.value, row.currency)
                            )}
                          </TD>
                          <TD numeric>{f.number(row.clicks)}</TD>
                          <TD numeric>{f.number(row.customers)}</TD>
                          {canManage ? (
                            <TD className="w-px whitespace-nowrap text-right">
                              <div className="flex items-center justify-end gap-1">
                                {row.status === "pending" ? (
                                  <ApproveParticipationButton
                                    workspaceSlug={workspaceSlug}
                                    participationId={row.participationId}
                                    affiliateName={affiliate.name}
                                  />
                                ) : null}
                                <AffiliateRowActions
                                  workspaceSlug={workspaceSlug}
                                  participationId={row.participationId}
                                  affiliateName={affiliate.name}
                                  programName={row.programName}
                                  status={row.status}
                                  currency={row.currency}
                                  programRate={programRate}
                                  customRate={custom}
                                />
                              </div>
                            </TD>
                          ) : null}
                        </TR>
                      )
                    })}
                  </TBody>
                </Table>
              </TableContainer>
            )}
          </section>

          {/* Links */}
          <section>
            <SectionHeader title={t("links.title")} count={links.length > 0 ? f.number(links.length) : undefined} />
            {links.length === 0 ? (
              <EmptyState
                icon={Link2}
                title={t("links.emptyTitle")}
                description={t("links.emptyDescription")}
                className="border-y border-border py-10"
              />
            ) : (
              <TableContainer scrollable>
                <Table className="min-w-2xl">
                  <THead>
                    <tr>
                      <TH>{tc("link")}</TH>
                      <TH>{tc("program")}</TH>
                      <TH>{t("links.destination")}</TH>
                      <TH numeric>{tc("clicks")}</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {links.map((link) => (
                      <TR key={link.id}>
                        <TD className="whitespace-nowrap">
                          <span className="block text-foreground">{link.name ?? link.code}</span>
                          <span className="block font-mono text-meta text-muted-foreground">{link.code}</span>
                        </TD>
                        <TD className="whitespace-nowrap">{link.programName}</TD>
                        <TD mono className="max-w-64 truncate" title={link.destinationUrl ?? undefined}>
                          {link.destinationUrl ?? "—"}
                        </TD>
                        <TD numeric>{f.number(link.clicks)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableContainer>
            )}
          </section>

          {/* Recent conversions */}
          <section>
            <SectionHeader
              title={t("conversions.title")}
              count={conversions.total > 0 ? f.number(conversions.total) : undefined}
              action={
                conversions.total > 0 ? (
                  <ViewAll href={conversionsHref}>{t("viewAll")}</ViewAll>
                ) : undefined
              }
            />
            {conversions.rows.length === 0 ? (
              <EmptyState
                icon={Receipt}
                title={t("conversions.emptyTitle")}
                description={t("conversions.emptyDescription")}
                className="border-y border-border py-10"
              />
            ) : (
              <TableContainer stickyFirstColumn>
                <Table className="min-w-2xl">
                  <THead>
                    <tr>
                      <TH>{tc("date")}</TH>
                      <TH>{tc("customer")}</TH>
                      <TH numeric>{tc("baseAmount")}</TH>
                      <TH numeric>{tc("commission")}</TH>
                      <TH>{tc("status")}</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {conversions.rows.map((row) => (
                      <TR key={row.id}>
                        <TD className="whitespace-nowrap text-muted-foreground">{f.date(row.occurredAt)}</TD>
                        <TD mono>
                          <Link
                            href={{
                              pathname: "/[workspaceSlug]/conversions/[conversionId]",
                              params: { workspaceSlug, conversionId: row.id },
                            }}
                            title={tconv("openTrail")}
                            className="rounded-badge text-foreground hover:underline"
                          >
                            {row.customerRef}
                          </Link>
                        </TD>
                        <TD numeric>{f.money(row.amountMinor, row.currency)}</TD>
                        <TD numeric className={row.commissionMinor < 0 ? "text-danger-foreground" : "text-foreground"}>
                          {f.money(row.commissionMinor, row.currency, {
                            signDisplay: row.commissionMinor < 0 ? "always" : "auto",
                          })}
                        </TD>
                        <TD>
                          <StatusBadge status={row.status} label={tcs(row.status)} />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableContainer>
            )}
          </section>

          {/* Recent commissions */}
          <section className="pb-4">
            <SectionHeader
              title={t("commissions.title")}
              count={commissions.total > 0 ? f.number(commissions.total) : undefined}
              action={
                commissions.total > 0 ? (
                  <ViewAll href={commissionsHref()}>{t("viewAll")}</ViewAll>
                ) : undefined
              }
            />
            {commissions.rows.length === 0 ? (
              <EmptyState
                icon={Coins}
                title={t("commissions.emptyTitle")}
                description={t("commissions.emptyDescription")}
                className="border-y border-border py-10"
              />
            ) : (
              <TableContainer stickyFirstColumn>
                <Table className="min-w-2xl">
                  <THead>
                    <tr>
                      <TH>{tc("date")}</TH>
                      <TH>{tc("program")}</TH>
                      <TH numeric>{tc("commission")}</TH>
                      <TH>{tc("status")}</TH>
                      <TH>{tc("releasedOn")}</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {commissions.rows.map((row) => (
                      <TR key={row.id}>
                        <TD className="whitespace-nowrap text-muted-foreground">{f.date(row.occurredAt)}</TD>
                        <TD className="whitespace-nowrap">
                          <Link
                            href={{
                              pathname: "/[workspaceSlug]/conversions/[conversionId]",
                              params: { workspaceSlug, conversionId: row.id },
                            }}
                            title={tconv("openTrail")}
                            className="block rounded-badge text-foreground hover:underline"
                          >
                            {row.programName}
                          </Link>
                          {/* The engine's trace of the rule, read back into words. */}
                          {describeRuleApplied(row.ruleApplied, row.currency, f, trule) ? (
                            <span className="block max-w-64 truncate text-meta text-muted-foreground">
                              {describeRuleApplied(row.ruleApplied, row.currency, f, trule)}
                            </span>
                          ) : null}
                        </TD>
                        <TD
                          numeric
                          className={row.commissionAmountMinor < 0 ? "text-danger-foreground" : "text-foreground"}
                        >
                          {f.money(row.commissionAmountMinor, row.currency, {
                            signDisplay: row.commissionAmountMinor < 0 ? "always" : "auto",
                          })}
                        </TD>
                        <TD>
                          <StatusBadge status={row.status} label={tcs(row.status)} />
                        </TD>
                        <TD className="whitespace-nowrap text-muted-foreground">{f.date(row.eligibleAt)}</TD>
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

function ViewAll({
  href,
  children,
}: {
  href: React.ComponentProps<typeof Link>["href"]
  children: React.ReactNode
}) {
  return (
    <Button asChild variant="ghost" size="sm">
      <Link href={href}>
        {children}
        <ArrowRight aria-hidden="true" />
      </Link>
    </Button>
  )
}
