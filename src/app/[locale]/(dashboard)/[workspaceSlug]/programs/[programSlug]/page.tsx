import { ArrowRight, Coins, Users } from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"
import { notFound } from "next/navigation"
import type * as React from "react"

import { Link } from "@/i18n/navigation"

import { Metric, MetricCell, MetricGrid } from "@/components/data-display/metric"
import { getFormatters } from "@/i18n/format"
import { EmptyState } from "@/components/feedback/empty-state"
import { InlineAlert } from "@/components/feedback/inline-alert"
import { PageHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { Term } from "@/components/ui/term"
import { formatMoneyTotals } from "@/lib/money-totals"
import { InviteAffiliateDialog } from "@/features/affiliates/invite-affiliate-dialog"
import { EnvironmentBadge } from "@/features/programs/environment-badge"
import { ProgramAffiliateActions } from "@/features/programs/program-affiliate-actions"
import { ProgramForm } from "@/features/programs/program-form"
import { SimulateConversionDialog } from "@/features/sandbox/simulate-conversion-dialog"
import { PROGRAM_TABS, type ProgramTab } from "@/features/programs/program-tab-ids"
import { ProgramTabs } from "@/features/programs/program-tabs"
import { currencyOptions } from "@/features/workspaces/options"
import { minorToMajor } from "@/lib/money"
import { getSessionUser, requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listAffiliates, listApprovedParticipationOptions } from "@/server/repositories/affiliates"
import { listCommissions } from "@/server/repositories/commissions"
import { countProgramTabs, findProgramBySlug, getProgramTotals } from "@/server/repositories/programs"
import { getPlanOverview } from "@/server/services/plans"
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
  const locale = await getLocale()
  const { workspaceSlug, programSlug } = await params
  const query = await searchParams
  // Performance leads the page, so there is no "overview" tab any more; an old
  // `?tab=overview` link lands on the first tab.
  const tab: ProgramTab = PROGRAM_TABS.includes(query.tab as ProgramTab) ? (query.tab as ProgramTab) : "affiliates"

  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)
  const f = await getFormatters(workspace.timezone)

  const program = await withUser(user.id, (tx) =>
    findProgramBySlug(tx, workspace.id, programSlug),
  )
  if (!program) notFound()

  // Only the active tab's rows are read; the other tabs show counts.
  const [totals, counts, affiliates, commissions] = await withUser(user.id, (tx) =>
    Promise.all([
      // Program-wide aggregates: never summed from the capped preview lists.
      getProgramTotals(tx, program.id),
      countProgramTabs(tx, workspace.id, program.id),
      tab === "affiliates"
        ? listAffiliates(tx, { workspaceId: workspace.id, programId: program.id, limit: PREVIEW_LIMIT })
        : null,
      tab === "commissions"
        ? listCommissions(tx, { workspaceId: workspace.id, programId: program.id, limit: PREVIEW_LIMIT })
        : null,
    ]),
  )

  // Per currency, the program's own currency first; see lib/money-totals.
  const revenue = formatMoneyTotals(f.money, totals.revenue, program.currency)
  const commissionTotal = formatMoneyTotals(f.money, totals.commission, program.currency)
  const otherCurrencies = (others: string | null) =>
    others ? tm("otherCurrencies", { amounts: others }) : null

  const tabHref = (value: ProgramTab) =>
    ({
      pathname: "/[workspaceSlug]/programs/[programSlug]",
      params: { workspaceSlug, programSlug },
      query: { tab: value },
    }) as const

  // An archived program takes no new affiliates: nothing to invite into.
  const programRef = program.status === "archived" ? [] : [{ id: program.id, name: program.name }]
  const canManage = workspace.role !== "member"
  const customRatesAvailable = canManage
    ? (await getPlanOverview(user.id, workspace.id)).entitlements.capabilities.features.customAffiliateRates
    : false
  // A test program can run a whole conversion without Stripe (docs/PLANS.md
  // §2). Owners and admins only — the service refuses members and live programs.
  const simulation =
    canManage && program.environment === "test" && tab !== "settings"
      ? await withUser(user.id, (tx) => listApprovedParticipationOptions(tx, workspace.id, program.id))
      : null

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
          // The settings tab has its own primary action (save); one per view.
          tab === "settings" ? null : (
            <InviteAffiliateDialog
              workspaceSlug={workspaceSlug}
              programs={programRef}
              defaultProgramId={program.id}
              customRatesAvailable={customRatesAvailable}
            />
          )
        }
      />

      {/* Detail pages sit left-aligned at the narrower detail width. */}
      <div>
        <div className="max-w-detail space-y-10">
          <div className="space-y-4">
            {/* The name is already the last crumb of the bar above. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="flex items-center gap-1.5">
                <EnvironmentBadge environment={program.environment} />
                <StatusBadge status={program.status} />
              </span>
              {program.description ? (
                <p className="max-w-prose text-pretty text-caption text-muted-foreground">
                  {program.description}
                </p>
              ) : null}
            </div>

            {/* Every affiliate's default link points at the program's site;
                without one the portal says "Link padrão indisponível". */}
            {!program.websiteUrl && tab !== "settings" ? (
              <InlineAlert
                title={t("websiteMissing.title")}
                action={
                  canManage ? (
                    <Button asChild variant="secondary" size="sm">
                      <Link href={tabHref("settings")} scroll={false}>
                        {t("websiteMissing.action")}
                      </Link>
                    </Button>
                  ) : undefined
                }
              >
                {t("websiteMissing.description")}
              </InlineAlert>
            ) : null}

            {simulation ? (
              <InlineAlert
                title={t("simulation.title")}
                action={
                  simulation.length > 0 ? (
                    <SimulateConversionDialog
                      workspaceSlug={workspaceSlug}
                      programId={program.id}
                      participations={simulation}
                      currency={program.currency}
                    />
                  ) : undefined
                }
              >
                {simulation.length > 0 ? t("simulation.description") : t("simulation.needsAffiliate")}
              </InlineAlert>
            ) : null}

            {/* Performance first: how the program is doing is why the page is opened. */}
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

            {/* Configuration second, and quieter: a definition row, not a second metric strip. */}
            <dl
              aria-label={t("configuration")}
              className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4"
            >
              <Setting term={tc("commission")}>
                {rule}
                <span className="text-muted-foreground">{` · ${duration}`}</span>
              </Setting>
              <Setting term={<Term definition={t("terms.window")}>{t("window")}</Term>}>
                {t("nDays", { count: program.attributionWindowDays })}
              </Setting>
              <Setting term={<Term definition={t("terms.model")}>{t("model")}</Term>}>
                {program.attributionModel === "last_click" ? t("lastClick") : t("firstClick")}
              </Setting>
              <Setting term={<Term definition={t("terms.hold")}>{t("hold")}</Term>}>
                {t("nDays", { count: program.commissionHoldDays })}
              </Setting>
            </dl>
          </div>

          <ProgramTabs
            workspaceSlug={workspaceSlug}
            programSlug={programSlug}
            active={tab}
            label={t("sections")}
            tabs={[
              { value: "affiliates", label: t("tabs.affiliates"), count: f.number(counts.affiliates) },
              { value: "commissions", label: t("tabs.commissions"), count: f.number(counts.commissions) },
              { value: "settings", label: t("tabs.settings") },
            ]}
          >
            {affiliates ? (
              affiliates.rows.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title={t("emptyAffiliates.title")}
                  description={t("emptyAffiliates.description")}
                  action={
                    // The header already carries the primary invite.
                    <InviteAffiliateDialog
                      workspaceSlug={workspaceSlug}
                      programs={programRef}
                      defaultProgramId={program.id}
                      triggerVariant="secondary"
                      triggerSize="md"
                      customRatesAvailable={customRatesAvailable}
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
                          <TH className="w-10">
                            <span className="sr-only">{tc("actions")}</span>
                          </TH>
                        </tr>
                      </THead>
                      <TBody>
                        {affiliates.rows.map((row) => {
                          const status = row.participationStatus ?? row.status
                          const label = row.participationStatus
                            ? ta(`status.${row.participationStatus}`)
                            : undefined
                          const actions = (
                            <ProgramAffiliateActions
                              workspaceSlug={workspaceSlug}
                              affiliateId={row.affiliateId}
                              affiliateName={row.name}
                              programId={program.id}
                            />
                          )
                          return (
                            <TR key={row.participationId ?? row.affiliateId}>
                              <TD className="max-md:py-2.5">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="truncate text-foreground">{row.name}</span>
                                  <span className="flex shrink-0 items-center gap-1 md:hidden">
                                    <StatusBadge status={status} label={label} />
                                    {actions}
                                  </span>
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
                              <TD className="text-right max-md:hidden">{actions}</TD>
                            </TR>
                          )
                        })}
                      </TBody>
                    </Table>
                  </TableContainer>
                  {affiliates.total > affiliates.rows.length ? (
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

            {commissions ? (
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
                          <TH>{tc("date")}</TH>
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
                            <TD className="whitespace-nowrap tabular-nums text-muted-foreground">
                              {f.date(row.createdAt)}
                            </TD>
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
                  {commissions.total > commissions.rows.length ? (
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
                currencyOptions={currencyOptions(locale)}
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
          </ProgramTabs>
        </div>
      </div>
    </>
  )
}

/** One configuration value: muted term above, value below. */
function Setting({ term, children }: { term: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-meta text-muted-foreground">{term}</dt>
      <dd className="mt-0.5 truncate text-caption tabular-nums text-foreground-secondary">{children}</dd>
    </div>
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
