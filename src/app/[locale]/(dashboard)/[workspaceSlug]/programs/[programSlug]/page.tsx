import { ArrowRight, Coins, Users } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { notFound } from "next/navigation"
import type * as React from "react"

import { Link } from "@/i18n/navigation"

import { Metric, MetricCell, MetricGrid } from "@/components/data-display/metric"
import { getFormatters } from "@/i18n/format"
import { EmptyState } from "@/components/feedback/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TabLink } from "@/components/ui/tabs"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { Term } from "@/components/ui/term"
import { formatMoneyTotals } from "@/lib/money-totals"
import { InviteAffiliateDialog } from "@/features/affiliates/invite-affiliate-dialog"
import { ProgramForm } from "@/features/programs/program-form"
import { minorToMajor } from "@/lib/money"
import { getSessionUser, requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listAffiliates } from "@/server/repositories/affiliates"
import { listCommissions } from "@/server/repositories/commissions"
import { findProgramBySlug, getProgramTotals } from "@/server/repositories/programs"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const dynamic = "force-dynamic"

/**
 * The program's name in the tab title. Metadata must never take the page down:
 * no session, no access, an unknown slug or a failed read all fall back to the
 * generic translated title, and the page itself renders the real outcome.
 */
export async function generateMetadata({
  params,
}: PageProps<"/[locale]/[workspaceSlug]/programs/[programSlug]">): Promise<Metadata> {
  const { locale, workspaceSlug, programSlug } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.program" })
  try {
    const user = await getSessionUser()
    if (user) {
      const workspace = await getWorkspaceForUser(user.id, workspaceSlug)
      const program = await withUser(user.id, (tx) =>
        findProgramBySlug(tx, workspace.id, programSlug),
      )
      if (program) return { title: program.name }
    }
  } catch {
    // Fall through to the generic title.
  }
  return { title: t("metaTitle") }
}

const TABS = ["overview", "affiliates", "commissions", "settings"] as const
type Tab = (typeof TABS)[number]

/** Tab lists are a preview; the full, filterable list lives on its own page. */
const PREVIEW_LIMIT = 50

export default async function ProgramDetailPage({
  params,
  searchParams,
}: PageProps<"/[locale]/[workspaceSlug]/programs/[programSlug]">) {
  const t = await getTranslations("dashboard.program")
  const tp = await getTranslations("dashboard.programs")
  const ta = await getTranslations("dashboard.affiliates")
  const tc = await getTranslations("common.table")
  const tm = await getTranslations("common.money")
  const f = await getFormatters()
  const { workspaceSlug, programSlug } = await params
  const query = await searchParams
  const tab: Tab = TABS.includes(query.tab as Tab) ? (query.tab as Tab) : "overview"

  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)

  const program = await withUser(user.id, (tx) =>
    findProgramBySlug(tx, workspace.id, programSlug),
  )
  if (!program) notFound()

  const [affiliates, commissions, totals] = await withUser(user.id, (tx) =>
    Promise.all([
      listAffiliates(tx, { workspaceId: workspace.id, programId: program.id, limit: PREVIEW_LIMIT }),
      listCommissions(tx, { workspaceId: workspace.id, programId: program.id, limit: PREVIEW_LIMIT }),
      // Program-wide aggregates: the overview never sums the capped preview list.
      getProgramTotals(tx, program.id),
    ]),
  )

  const affiliatesCapped = affiliates.total > affiliates.rows.length
  const commissionsCapped = commissions.total > commissions.rows.length

  // Per currency, the program's own currency first; see lib/money-totals.
  const revenue = formatMoneyTotals(f.money, totals.revenue, program.currency)
  const commissionTotal = formatMoneyTotals(f.money, totals.commission, program.currency)
  const otherCurrencies = (others: string | null) =>
    others ? tm("otherCurrencies", { amounts: others }) : null

  const tabHref = (value: Tab) =>
    ({
      pathname: "/[workspaceSlug]/programs/[programSlug]",
      params: { workspaceSlug, programSlug },
      query: { tab: value },
    }) as const

  const programRef = [{ id: program.id, name: program.name }]

  const rule =
    program.commissionType === "percentage"
      ? f.basisPoints(program.commissionValue)
      : f.money(program.commissionValue, program.currency)
  const duration =
    program.commissionDurationMonths === null
      ? t("lifetime")
      : program.commissionDurationMonths === 1
        ? t("firstPayment")
        : t("nMonths", { count: program.commissionDurationMonths })

  return (
    <>
      <PageHeader
        title={program.name}
        breadcrumb={[
          <Link
            key="programs"
            href={{ pathname: "/[workspaceSlug]/programs", params: { workspaceSlug } }}
          >
            {tp("title")}
          </Link>,
        ]}
        actions={
          // The settings tab has its own amber action (save); one per view.
          tab === "settings" ? null : (
            <InviteAffiliateDialog
              workspaceSlug={workspaceSlug}
              programs={programRef}
              defaultProgramId={program.id}
            />
          )
        }
      />

      {/* Detail pages sit left-aligned at the narrower detail width. */}
      <div>
        <div className="max-w-detail space-y-8">
          <div className="space-y-4">
            {/* The name is already the last crumb of the bar above. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <StatusBadge status={program.status} />
              {program.description ? (
                <p className="max-w-prose text-pretty text-caption text-muted-foreground">
                  {program.description}
                </p>
              ) : null}
            </div>

            <MetricGrid className="sm:grid-cols-2 md:grid-cols-4">
              <MetricCell>
                <Metric label={tc("commission")} value={rule} comparison={duration} />
              </MetricCell>
              <MetricCell>
                <Metric
                  label={<Term definition={t("terms.window")}>{t("window")}</Term>}
                  value={t("nDays", { count: program.attributionWindowDays })}
                />
              </MetricCell>
              <MetricCell>
                <Metric
                  label={<Term definition={t("terms.model")}>{t("model")}</Term>}
                  value={program.attributionModel === "last_click" ? t("lastClick") : t("firstClick")}
                />
              </MetricCell>
              <MetricCell>
                <Metric
                  label={<Term definition={t("terms.hold")}>{t("hold")}</Term>}
                  value={t("nDays", { count: program.commissionHoldDays })}
                />
              </MetricCell>
            </MetricGrid>
          </div>

          <div className="space-y-6">
            <nav
              className="-mx-4 flex items-center gap-5 overflow-x-auto border-b border-border px-4 md:mx-0 md:px-0"
              aria-label={t("sections")}
            >
              {TABS.map((value) => (
                <TabLink
                  key={value}
                  href={tabHref(value)}
                  active={tab === value}
                  className="shrink-0"
                >
                  {t(`tabs.${value}`)}
                  {value === "affiliates" || value === "commissions" ? (
                    <span className="font-normal tabular-nums text-muted-foreground">
                      {f.number(value === "affiliates" ? affiliates.total : commissions.total)}
                    </span>
                  ) : null}
                </TabLink>
              ))}
            </nav>

            {tab === "overview" ? (
              <div>
                <MetricGrid className="sm:grid-cols-2 md:grid-cols-4">
                  <MetricCell>
                    <Metric label={tc("clicks")} value={f.number(totals.clicks)} />
                  </MetricCell>
                  <MetricCell>
                    <Metric
                      label={tc("customers")}
                      value={f.number(totals.customers)}
                      comparison={t("ofClicks", { rate: f.rate(totals.customers, totals.clicks) })}
                    />
                  </MetricCell>
                  <MetricCell>
                    <Metric
                      label={tc("revenue")}
                      value={revenue.primary}
                      secondaryValue={otherCurrencies(revenue.others)}
                    />
                  </MetricCell>
                  <MetricCell>
                    <Metric
                      label={tc("commission")}
                      value={commissionTotal.primary}
                      secondaryValue={otherCurrencies(commissionTotal.others)}
                    />
                  </MetricCell>
                </MetricGrid>
              </div>
            ) : null}

            {tab === "affiliates" ? (
              affiliates.rows.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title={t("emptyAffiliates.title")}
                  description={t("emptyAffiliates.description")}
                  action={
                    // The header already carries the amber invite.
                    <InviteAffiliateDialog
                      workspaceSlug={workspaceSlug}
                      programs={programRef}
                      defaultProgramId={program.id}
                      triggerVariant="secondary"
                      triggerSize="md"
                    />
                  }
                />
              ) : (
                <div>
                  <TableContainer>
                    <Table>
                      <THead className="max-md:hidden">
                        <tr>
                          <TH>{tc("affiliate")}</TH>
                          <TH>{tc("status")}</TH>
                          <TH numeric>{tc("clicks")}</TH>
                          <TH numeric>{tc("customers")}</TH>
                          <TH numeric>{tc("commission")}</TH>
                        </tr>
                      </THead>
                      <TBody>
                        {affiliates.rows.map((row) => {
                          const status = row.participationStatus ?? row.status
                          const label = row.participationStatus
                            ? ta(`status.${row.participationStatus}`)
                            : undefined
                          return (
                            <TR key={row.participationId ?? row.affiliateId}>
                              <TD className="max-md:py-2.5">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="truncate text-foreground">{row.name}</span>
                                  <StatusBadge status={status} label={label} className="md:hidden" />
                                </div>
                                <span className="block font-mono text-meta text-muted-foreground max-md:hidden">
                                  {row.code}
                                </span>
                                <span className="mt-0.5 flex gap-3 text-meta text-muted-foreground md:hidden">
                                  <span>
                                    {tc("clicks")}{" "}
                                    <span className="tabular-nums text-foreground-secondary">
                                      {f.number(row.clicks)}
                                    </span>
                                  </span>
                                  <span className="ml-auto tabular-nums text-foreground">
                                    {f.money(row.commissionMinor, program.currency)}
                                  </span>
                                </span>
                              </TD>
                              <TD className="max-md:hidden">
                                <StatusBadge status={status} label={label} />
                              </TD>
                              <TD numeric className="max-md:hidden">
                                {f.number(row.clicks)}
                              </TD>
                              <TD numeric className="max-md:hidden">
                                {f.number(row.customers)}
                              </TD>
                              <TD numeric className="text-foreground max-md:hidden">
                                {f.money(row.commissionMinor, program.currency)}
                              </TD>
                            </TR>
                          )
                        })}
                      </TBody>
                    </Table>
                  </TableContainer>
                  {affiliatesCapped ? (
                    <CappedFooter
                      summary={t("affiliatesCapped", { shown: affiliates.rows.length, total: affiliates.total })}
                      link={
                        <Link
                          href={{
                            pathname: "/[workspaceSlug]/affiliates",
                            params: { workspaceSlug },
                            query: { program: program.id },
                          }}
                        >
                          {t("viewAllAffiliates")}
                          <ArrowRight aria-hidden="true" />
                        </Link>
                      }
                    />
                  ) : null}
                </div>
              )
            ) : null}

            {tab === "commissions" ? (
              commissions.rows.length === 0 ? (
                <EmptyState
                  icon={Coins}
                  title={t("emptyCommissions.title")}
                  description={t("emptyCommissions.description")}
                  action={
                    <Button asChild variant="secondary">
                      <Link
                        href={{ pathname: "/[workspaceSlug]/integrations", params: { workspaceSlug } }}
                      >
                        {t("emptyCommissions.action")}
                      </Link>
                    </Button>
                  }
                />
              ) : (
                <div>
                  <TableContainer scrollable>
                    <Table className="min-w-xl">
                      <THead>
                        <tr>
                          <TH>{tc("affiliate")}</TH>
                          <TH>{tc("customer")}</TH>
                          <TH numeric>{tc("baseAmount")}</TH>
                          <TH numeric>{tc("commission")}</TH>
                          <TH>{tc("status")}</TH>
                        </tr>
                      </THead>
                      <TBody>
                        {commissions.rows.map((row) => (
                          <TR key={row.id}>
                            <TD className="whitespace-nowrap text-foreground">{row.affiliateName}</TD>
                            <TD mono>{row.customerRef}</TD>
                            <TD numeric>{f.money(row.baseAmountMinor, row.currency)}</TD>
                            <TD
                              numeric
                              className={
                                row.commissionAmountMinor < 0
                                  ? "text-danger-foreground"
                                  : "text-foreground"
                              }
                            >
                              {f.money(row.commissionAmountMinor, row.currency, {
                                signDisplay: row.commissionAmountMinor < 0 ? "always" : "auto",
                              })}
                            </TD>
                            <TD>
                              <StatusBadge status={row.status} />
                            </TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </TableContainer>
                  {commissionsCapped ? (
                    <CappedFooter
                      summary={t("commissionsCapped", { shown: commissions.rows.length, total: commissions.total })}
                      link={
                        <Link
                          href={{
                            pathname: "/[workspaceSlug]/commissions",
                            params: { workspaceSlug },
                            query: { program: program.id },
                          }}
                        >
                          {t("viewAllCommissions")}
                          <ArrowRight aria-hidden="true" />
                        </Link>
                      }
                    />
                  ) : null}
                </div>
              )
            ) : null}

            {tab === "settings" ? (
              <ProgramForm
                mode="edit"
                workspaceSlug={workspaceSlug}
                defaultValues={{
                  id: program.id,
                  name: program.name,
                  description: program.description ?? "",
                  websiteUrl: program.websiteUrl ?? "",
                  status: program.status,
                  commissionType: program.commissionType,
                  commissionAmount: String(
                    program.commissionType === "percentage"
                      ? program.commissionValue / 100
                      : minorToMajor(program.commissionValue, program.currency),
                  ),
                  recurrence:
                    program.commissionDurationMonths === null
                      ? "lifetime"
                      : program.commissionDurationMonths === 1
                        ? "first_only"
                        : "months",
                  durationMonths: String(program.commissionDurationMonths ?? 12),
                  attributionModel: program.attributionModel,
                  attributionWindowDays: String(program.attributionWindowDays),
                  commissionHoldDays: String(program.commissionHoldDays),
                  currency: program.currency,
                }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </>
  )
}

/** Says a preview list stopped short, and where the rest is. */
function CappedFooter({ summary, link }: { summary: string; link: React.ReactElement }) {
  return (
    <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-meta text-muted-foreground">
      <span className="tabular-nums">{summary}</span>
      <Button asChild variant="ghost" size="sm">
        {link}
      </Button>
    </div>
  )
}
