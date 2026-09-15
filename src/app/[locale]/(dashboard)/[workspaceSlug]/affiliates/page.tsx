import { Clock, Layers, Search, SearchX, Users, X } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { Link } from "@/i18n/navigation"

import { EmptyState } from "@/components/feedback/empty-state"
import { getFormatters } from "@/i18n/format"
import { PageHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FilterBar } from "@/components/ui/filter-bar"
import { Input, Select } from "@/components/ui/input"
import { Pagination } from "@/components/ui/pagination"
import { SortableHeader } from "@/components/ui/sortable-header"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import {
  ApproveParticipationButton,
  AffiliateRowActions,
} from "@/features/affiliates/affiliate-row-actions"
import { AffiliateLimitNotice } from "@/features/affiliates/affiliate-limit-notice"
import { InviteAffiliateDialog } from "@/features/affiliates/invite-affiliate-dialog"
import {
  firstParam,
  nextSort,
  pageWindow,
  parsePage,
  parseSearch,
  parseSort,
  type SortState,
} from "@/lib/list-params"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import {
  countPendingParticipations,
  listAffiliates,
  type AffiliateSortField,
} from "@/server/repositories/affiliates"
import { listPrograms } from "@/server/repositories/programs"
import { getPlanOverview } from "@/server/services/plans"
import { getViewEnvironment } from "@/server/services/view-environment"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/[workspaceSlug]/affiliates">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.affiliates" })
  return { title: t("title") }
}

const PAGE_SIZE = 25
const STATUSES = ["approved", "pending", "suspended", "rejected"] as const
type ParticipationStatus = (typeof STATUSES)[number]

const SORT = {
  fields: ["name", "joined", "revenue", "commission"] as const satisfies readonly AffiliateSortField[],
  defaultSort: { field: "joined", dir: "desc" } as SortState<AffiliateSortField>,
  naturalDir: { name: "asc" } as const,
}

export default async function AffiliatesPage({
  params,
  searchParams,
}: PageProps<"/[locale]/[workspaceSlug]/affiliates">) {
  const t = await getTranslations("dashboard.affiliates")
  const tc = await getTranslations("common.table")
  const ta = await getTranslations("common.actions")
  const tp = await getTranslations("common.pagination")
  const { workspaceSlug } = await params
  const query = await searchParams

  const search = parseSearch(query.q)
  const rawStatus = firstParam(query.status)
  const status = STATUSES.find((value) => value === rawStatus)
  const sort = parseSort(query, SORT)
  const page = parsePage(query.page)

  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)
  const f = await getFormatters(workspace.timezone)
  const [allPrograms, plan, { environment }] = await Promise.all([
    withUser(user.id, (tx) => listPrograms(tx, workspace.id)),
    getPlanOverview(user.id, workspace.id),
    getViewEnvironment(user.id, workspace.id),
  ])
  // The list, its filter and the invite dialog follow the shell's environment:
  // participations and their figures in live and test programs are never mixed.
  const programs = allPrograms.filter((program) => program.environment === environment)
  // Custom rates are a plan feature; the dialogs offer them only when included.
  const customRatesAvailable = plan.entitlements.capabilities.features.customAffiliateRates

  // Only a program of this workspace narrows the list; anything else is ignored.
  const rawProgram = firstParam(query.program)
  const programId = programs.some((program) => program.id === rawProgram) ? rawProgram : undefined

  const [result, pendingCount] = await withUser(user.id, async (tx) => [
    await listAffiliates(tx, {
      workspaceId: workspace.id,
      environment,
      programId,
      search,
      status,
      sort,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    await countPendingParticipations(tx, workspace.id, environment),
  ] as const)

  const paging = pageWindow(page, result.total, PAGE_SIZE)
  const filtered = Boolean(search || status || programId)
  // An archived program takes no new affiliates.
  const programOptions = programs
    .filter((program) => program.status !== "archived")
    .map((program) => ({ id: program.id, name: program.name }))
  const listHref = { pathname: "/[workspaceSlug]/affiliates", params: { workspaceSlug } } as const
  const isDefaultSort = sort.field === SORT.defaultSort.field && sort.dir === SORT.defaultSort.dir

  const filters = {
    q: search,
    status,
    program: programId,
  }
  const sortQuery = isDefaultSort ? {} : { sort: sort.field, dir: sort.dir }
  const hrefWith = (overrides: Record<string, string | number | undefined>) => {
    const merged: Record<string, string | number> = {}
    for (const [key, value] of Object.entries({ ...filters, ...sortQuery, ...overrides })) {
      if (value !== undefined && value !== "") merged[key] = value
    }
    return { ...listHref, query: merged }
  }
  const pageHref = (target: number) => hrefWith({ page: target > 1 ? target : undefined })
  const sortHref = (field: AffiliateSortField) => {
    const next = nextSort(sort, field, field === "name" ? "asc" : "desc")
    return hrefWith({ sort: next.field, dir: next.dir, page: undefined })
  }
  const sorted = (field: AffiliateSortField) => (sort.field === field ? sort.dir : false)

  const statusLabel = (value: ParticipationStatus) => t(`status.${value}`)

  // The row menu's mutations require owner or admin; a member is not offered them.
  const canManage = workspace.role !== "member"

  // Affiliates join through a program: without one there is nothing to invite
  // them into, so the page points at the step that is actually missing.
  if (programs.length === 0) {
    return (
      <>
        <PageHeader title={t("title")} description={t("description")} />
        <EmptyState
          icon={Layers}
          title={t("noProgram.title")}
          description={t("noProgram.description")}
          action={
            <Button asChild variant="primary">
              <Link href={{ pathname: "/[workspaceSlug]/programs/new", params: { workspaceSlug } }}>
                {t("noProgram.action")}
              </Link>
            </Button>
          }
        />
      </>
    )
  }

  const hasAny = result.total > 0 || filtered

  return (
    <>
      <PageHeader
        title={t("title")}
        meta={result.total > 0 ? f.number(result.total) : undefined}
        description={t("description")}
        actions={
          // On a first run the empty state carries the one primary action.
          hasAny ? (
            <InviteAffiliateDialog
              workspaceSlug={workspaceSlug}
              programs={programOptions}
              defaultProgramId={programOptions.some((program) => program.id === programId) ? programId : undefined}
              openOnInviteParam
              customRatesAvailable={customRatesAvailable}
            />
          ) : null
        }
      />

      {canManage ? (
        <AffiliateLimitNotice
          workspaceSlug={workspaceSlug}
          entitlements={plan.entitlements}
          usage={plan.usage}
          className="mb-6"
        />
      ) : null}

      {hasAny ? (
        <FilterBar
          href={listHref}
          values={{ q: search, status, program: programId }}
          preserve={sortQuery}
          submitLabel={t("apply")}
          label={t("filtersLabel")}
        >
          <div className="relative w-full sm:w-64">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              name="q"
              defaultValue={search}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchLabel")}
              className="pl-8"
            />
          </div>
          <Select
            name="status"
            defaultValue={status ?? ""}
            aria-label={t("filterLabel")}
            className="w-auto min-w-40"
          >
            <option value="">{t("allStatuses")}</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {statusLabel(value)}
              </option>
            ))}
          </Select>
          {programs.length > 1 || programId ? (
            <Select
              name="program"
              defaultValue={programId ?? ""}
              aria-label={t("filterProgram")}
              className="w-auto min-w-44 max-w-full"
            >
              <option value="">{t("allPrograms")}</option>
              {programs.map((program) => (
                <option key={program.id} value={program.id}>
                  {program.name}
                </option>
              ))}
            </Select>
          ) : null}
          {/* Pending approvals are the founder's to-do: counted, one click to see. */}
          {pendingCount > 0 && status !== "pending" ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={hrefWith({ status: "pending", page: undefined })}>
                <Clock aria-hidden="true" />
                {t("pendingCount", { count: pendingCount })}
              </Link>
            </Button>
          ) : null}
          {filtered ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={{ ...listHref, query: sortQuery }}>
                <X aria-hidden="true" />
                {ta("clearFilters")}
              </Link>
            </Button>
          ) : null}
        </FilterBar>
      ) : null}

      {paging.pastEnd ? (
        <EmptyState
          icon={SearchX}
          title={tp("pastEndTitle")}
          description={tp("pastEndDescription", { pages: paging.pages })}
          action={
            <Button asChild variant="secondary">
              <Link href={pageHref(paging.pages)}>{tp("pastEndAction", { page: paging.pages })}</Link>
            </Button>
          }
        />
      ) : result.rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={filtered ? t("empty.filteredTitle") : t("empty.title")}
          description={filtered ? t("empty.filteredDescription") : t("empty.description")}
          action={
            filtered ? (
              <Button asChild variant="secondary">
                <Link href={listHref}>{ta("clearFilters")}</Link>
              </Button>
            ) : (
              <InviteAffiliateDialog
                workspaceSlug={workspaceSlug}
                programs={programOptions}
                triggerSize="md"
                openOnInviteParam
                customRatesAvailable={customRatesAvailable}
              />
            )
          }
        />
      ) : (
        <>
          <TableContainer>
            <Table>
              <THead className="max-md:hidden">
                <tr>
                  <SortableHeader href={sortHref("name")} sorted={sorted("name")}>
                    {tc("affiliate")}
                  </SortableHeader>
                  <TH className="max-lg:hidden">{tc("program")}</TH>
                  <TH>{tc("status")}</TH>
                  <TH numeric>{tc("clicks")}</TH>
                  <TH numeric className="max-lg:hidden">{tc("customers")}</TH>
                  <SortableHeader
                    href={sortHref("revenue")}
                    sorted={sorted("revenue")}
                    numeric
                    className="max-lg:hidden"
                  >
                    {tc("revenue")}
                  </SortableHeader>
                  <SortableHeader href={sortHref("commission")} sorted={sorted("commission")} numeric>
                    {tc("commission")}
                  </SortableHeader>
                  <TH numeric>{tc("conversionRate")}</TH>
                  <SortableHeader href={sortHref("joined")} sorted={sorted("joined")} className="max-xl:hidden">
                    {tc("joined")}
                  </SortableHeader>
                  {canManage ? (
                    <TH className="w-px">
                      <span className="sr-only">{tc("actions")}</span>
                    </TH>
                  ) : null}
                </tr>
              </THead>
              <TBody>
                {result.rows.map((row) => {
                  const rowStatus = row.participationStatus ?? row.status
                  const label = row.participationStatus ? statusLabel(row.participationStatus) : undefined
                  // A participation earns in its program's currency; the sums
                  // are in that currency, never the workspace default.
                  const currency = row.currency ?? workspace.defaultCurrency
                  const commission = f.money(row.commissionMinor, currency)
                  const otherCurrencies = row.hasOtherCurrencies ? (
                    <span className="block whitespace-nowrap text-meta text-muted-foreground">
                      {t("otherCurrenciesExcluded")}
                    </span>
                  ) : null
                  const detailHref = {
                    pathname: "/[workspaceSlug]/affiliates/[affiliateId]",
                    params: { workspaceSlug, affiliateId: row.affiliateId },
                  } as const
                  const participation =
                    canManage && row.participationId && row.participationStatus && row.programName && row.currency
                      ? {
                          id: row.participationId,
                          status: row.participationStatus,
                          programName: row.programName,
                          currency: row.currency,
                        }
                      : null
                  const actions = participation ? (
                    <div className="flex items-center justify-end gap-1">
                      {participation.status === "pending" ? (
                        <ApproveParticipationButton
                          workspaceSlug={workspaceSlug}
                          participationId={participation.id}
                          affiliateName={row.name}
                        />
                      ) : null}
                      <AffiliateRowActions
                        workspaceSlug={workspaceSlug}
                        participationId={participation.id}
                        affiliateName={row.name}
                        programName={participation.programName}
                        status={participation.status}
                        currency={participation.currency}
                        programRate={
                          row.programCommissionType && row.programCommissionValue !== null
                            ? { type: row.programCommissionType, value: row.programCommissionValue }
                            : null
                        }
                        customRate={
                          row.customCommissionType && row.customCommissionValue !== null
                            ? { type: row.customCommissionType, value: row.customCommissionValue }
                            : null
                        }
                        customRatesAvailable={customRatesAvailable}
                      />
                    </div>
                  ) : null
                  return (
                    <TR key={`${row.affiliateId}-${row.participationId ?? "none"}`}>
                      <TD className="max-md:py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <Link
                            href={detailHref}
                            className="truncate rounded-badge font-medium text-foreground hover:underline"
                          >
                            {row.name}
                          </Link>
                          <StatusBadge status={rowStatus} label={label} className="md:hidden" />
                        </div>
                        <span className="block truncate font-mono text-meta text-muted-foreground max-md:hidden">
                          {row.code ?? row.email}
                        </span>
                        <span className="mt-0.5 flex gap-3 text-meta text-muted-foreground md:hidden">
                          <span className="truncate">
                            {row.programName ?? "—"}
                            {" · "}
                            {tc("clicks")}{" "}
                            <span className="tabular-nums text-foreground-secondary">
                              {f.number(row.clicks)}
                            </span>
                          </span>
                          <span className="ml-auto shrink-0 tabular-nums text-foreground">{commission}</span>
                        </span>
                      </TD>
                      <TD className="max-lg:hidden">{row.programName ?? "—"}</TD>
                      <TD className="max-md:hidden">
                        <StatusBadge status={rowStatus} label={label} />
                      </TD>
                      <TD numeric className="max-md:hidden">
                        {f.number(row.clicks)}
                      </TD>
                      <TD numeric className="max-lg:hidden">
                        {f.number(row.customers)}
                      </TD>
                      <TD numeric className="max-lg:hidden">
                        {f.money(row.revenueMinor, currency)}
                      </TD>
                      <TD numeric className="text-foreground max-md:hidden">
                        {commission}
                        {otherCurrencies}
                      </TD>
                      <TD numeric className="max-md:hidden">
                        {f.rate(row.customers, row.clicks)}
                      </TD>
                      <TD className="whitespace-nowrap text-muted-foreground max-xl:hidden">
                        {f.date(row.joinedAt)}
                      </TD>
                      {canManage ? <TD className="w-px whitespace-nowrap text-right">{actions}</TD> : null}
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </TableContainer>

          {paging.pages > 1 ? (
            <Pagination
              label={t("pagination")}
              summary={t("pageOf", { page, pages: paging.pages, total: f.number(result.total) })}
              previous={page > 1 ? <Link href={pageHref(page - 1)} /> : null}
              next={page < paging.pages ? <Link href={pageHref(page + 1)} /> : null}
              previousLabel={ta("previous")}
              nextLabel={ta("next")}
            />
          ) : null}
        </>
      )}
    </>
  )
}
