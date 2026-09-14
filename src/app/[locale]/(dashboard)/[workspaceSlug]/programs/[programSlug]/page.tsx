import { Coins, Users } from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"
import { notFound } from "next/navigation"

import { getPathname, Link } from "@/i18n/navigation"

import { Metric, MetricCell, MetricGrid } from "@/components/data-display/metric"
import { getFormatters } from "@/i18n/format"
import { EmptyState } from "@/components/feedback/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TabLink } from "@/components/ui/tabs"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { InviteAffiliateDialog } from "@/features/affiliates/invite-affiliate-dialog"
import { ProgramForm } from "@/features/programs/program-form"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listAffiliates } from "@/server/repositories/affiliates"
import { listCommissions } from "@/server/repositories/commissions"
import { findProgramBySlug } from "@/server/repositories/programs"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const metadata: Metadata = { title: "Program" }
export const dynamic = "force-dynamic"

const TABS = ["overview", "affiliates", "commissions", "settings"] as const
type Tab = (typeof TABS)[number]

export default async function ProgramDetailPage({
  params,
  searchParams,
}: PageProps<"/[locale]/[workspaceSlug]/programs/[programSlug]">) {
  const t = await getTranslations("dashboard.program")
  const tp = await getTranslations("dashboard.programs")
  const tc = await getTranslations("common.table")
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

  const [affiliates, commissions] = await withUser(user.id, (tx) =>
    Promise.all([
      listAffiliates(tx, { workspaceId: workspace.id, programId: program.id, limit: 50 }),
      listCommissions(tx, { workspaceId: workspace.id, programId: program.id, limit: 50 }),
    ]),
  )

  const totals = affiliates.rows.reduce(
    (acc, row) => ({
      clicks: acc.clicks + row.clicks,
      customers: acc.customers + row.customers,
      revenue: acc.revenue + row.revenueMinor,
      commission: acc.commission + row.commissionMinor,
    }),
    { clicks: 0, customers: 0, revenue: 0, commission: 0 },
  )

  // TabLink renders a plain anchor, so the href has to be a real URL rather
  // than a canonical pathname — `getPathname` resolves the locale prefix and
  // the translated segments that `Link` would otherwise apply for us.
  const base = getPathname({
    href: {
      pathname: "/[workspaceSlug]/programs/[programSlug]",
      params: { workspaceSlug, programSlug },
    },
    locale: await getLocale(),
  })

  const programRef = [{ id: program.id, name: program.name }]

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
          <InviteAffiliateDialog
            workspaceSlug={workspaceSlug}
            programs={programRef}
            defaultProgramId={program.id}
          />
        }
      />

      <div>
        <div className="mx-auto max-w-detail space-y-8 md:pt-2">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <StatusBadge status={program.status} />
              <h2 className="text-title text-foreground">{program.name}</h2>
              {program.description ? (
                <p className="max-w-[68ch] text-pretty text-caption text-muted-foreground">
                  {program.description}
                </p>
              ) : null}
            </div>

            <dl className="grid grid-cols-2 gap-x-6 border-y border-border sm:grid-cols-3 lg:grid-cols-5">
              <SummaryItem
                label={tc("commission")}
                value={
                  program.commissionType === "percentage"
                    ? f.basisPoints(program.commissionValue)
                    : f.money(program.commissionValue, program.currency)
                }
              />
              <SummaryItem
                label={t("duration")}
                value={
                  program.commissionDurationMonths === null
                    ? t("lifetime")
                    : program.commissionDurationMonths === 1
                      ? t("firstPayment")
                      : t("nMonths", { count: program.commissionDurationMonths })
                }
              />
              <SummaryItem
                label={t("attribution")}
                value={t("windowDays", { count: program.attributionWindowDays })}
              />
              <SummaryItem
                label={t("model")}
                value={program.attributionModel === "last_click" ? t("lastClick") : t("firstClick")}
              />
              <SummaryItem label={t("hold")} value={t("nDays", { count: program.commissionHoldDays })} />
            </dl>
          </div>

          <div className="space-y-6">
            <nav
              className="-mx-4 flex items-center gap-5 overflow-x-auto border-b border-border px-4 md:mx-0 md:px-0"
              aria-label={t("sections")}
            >
              {TABS.map((value) => (
                <TabLink
                  key={value}
                  href={`${base}?tab=${value}`}
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
              <MetricGrid className="sm:grid-cols-2 md:grid-cols-4">
                <MetricCell>
                  <Metric label={tc("clicks")} value={f.number(totals.clicks)} />
                </MetricCell>
                <MetricCell>
                  <Metric
                    label={tc("customers")}
                    value={f.number(totals.customers)}
                    comparison={f.rate(totals.customers, totals.clicks)}
                  />
                </MetricCell>
                <MetricCell>
                  <Metric label={tc("revenue")} value={f.money(totals.revenue, program.currency)} />
                </MetricCell>
                <MetricCell>
                  <Metric
                    label={tc("commission")}
                    value={f.money(totals.commission, program.currency)}
                  />
                </MetricCell>
              </MetricGrid>
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
                      triggerLabel={t("emptyAffiliates.action")}
                      triggerVariant="secondary"
                      triggerSize="md"
                    />
                  }
                />
              ) : (
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
                        return (
                          <TR key={row.participationId ?? row.affiliateId}>
                            <TD className="max-md:py-2.5">
                              <div className="flex items-center justify-between gap-3">
                                <span className="truncate text-foreground">{row.name}</span>
                                <StatusBadge status={status} className="md:hidden" />
                              </div>
                              <span className="block font-mono text-label text-muted-foreground max-md:hidden">
                                {row.code}
                              </span>
                              <span className="mt-0.5 flex gap-3 text-meta text-muted-foreground md:hidden">
                                <span>
                                  {tc("clicks")}{" "}
                                  <span className="tabular-nums text-foreground-secondary">
                                    {f.number(row.clicks)}
                                  </span>
                                </span>
                                <span className="ml-auto tabular-nums text-foreground-secondary">
                                  {f.money(row.commissionMinor, program.currency)}
                                </span>
                              </span>
                            </TD>
                            <TD className="max-md:hidden">
                              <StatusBadge status={status} />
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
                <TableContainer scrollable>
                  <Table>
                    <THead>
                      <tr>
                        <TH>{tc("affiliate")}</TH>
                        <TH>{tc("customer")}</TH>
                        <TH numeric>{tc("base")}</TH>
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
                  status: program.status,
                  commissionType: program.commissionType,
                  commissionAmount: String(program.commissionValue / 100),
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

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 py-3">
      <dt className="truncate text-caption text-muted-foreground">{label}</dt>
      <dd className="truncate text-ui text-foreground">{value}</dd>
    </div>
  )
}
