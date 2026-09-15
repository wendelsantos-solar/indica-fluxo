import { Coins, SearchX, X } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { Link } from "@/i18n/navigation"

import { EmptyState } from "@/components/feedback/empty-state"
import { describeRuleApplied } from "@/features/conversions/rule-applied"
import { getFormatters } from "@/i18n/format"
import { PageHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FilterBar } from "@/components/ui/filter-bar"
import { Select } from "@/components/ui/input"
import { Pagination } from "@/components/ui/pagination"
import { SortableHeader } from "@/components/ui/sortable-header"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { Term } from "@/components/ui/term"
import {
  firstParam,
  nextSort,
  pageWindow,
  parsePage,
  parseSort,
  parseUuidParam,
  type SortState,
} from "@/lib/list-params"
import { formatMoneyTotalsInline } from "@/lib/money-totals"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listAffiliateOptions } from "@/server/repositories/affiliates"
import {
  listCommissions,
  type CommissionSortField,
  type CommissionStatus,
} from "@/server/repositories/commissions"
import { listPrograms } from "@/server/repositories/programs"
import { listIntegrations } from "@/server/services/integrations"
import { getViewEnvironment } from "@/server/services/view-environment"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/[workspaceSlug]/commissions">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.commissions" })
  return { title: t("title") }
}

const STATUSES: readonly CommissionStatus[] = [
  "pending",
  "available",
  "approved",
  "paid",
  "reversed",
  "rejected",
]

const PAGE_SIZE = 50

const SORT = {
  fields: ["date", "amount", "status"] as const satisfies readonly CommissionSortField[],
  defaultSort: { field: "date", dir: "desc" } as SortState<CommissionSortField>,
  naturalDir: { status: "asc" } as const,
}

export default async function CommissionsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/[workspaceSlug]/commissions">) {
  const t = await getTranslations("dashboard.commissions")
  const tc = await getTranslations("common.table")
  const ta = await getTranslations("common.actions")
  const tp = await getTranslations("common.pagination")
  const { workspaceSlug } = await params
  const query = await searchParams

  const rawStatus = firstParam(query.status)
  const status = STATUSES.find((value) => value === rawStatus)
  const sort = parseSort(query, SORT)
  const page = parsePage(query.page)
  const requestedAffiliate = parseUuidParam(query.affiliate)

  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)
  const f = await getFormatters(workspace.timezone)
  const trule = await getTranslations("common.rule")
  const { environment } = await getViewEnvironment(user.id, workspace.id)

  const { programs, affiliateOptions, integrations } = await withUser(user.id, async (tx) => ({
    // Only this environment's programs: rows and totals never mix test and live.
    programs: (await listPrograms(tx, workspace.id)).filter((program) => program.environment === environment),
    affiliateOptions: await listAffiliateOptions(tx, workspace.id, { include: requestedAffiliate }),
    integrations: await listIntegrations(tx, workspace.id),
  }))

  // Only ids of this workspace narrow the list; anything else is ignored.
  const rawProgram = firstParam(query.program)
  const programId = programs.some((program) => program.id === rawProgram) ? rawProgram : undefined
  const affiliateId = affiliateOptions.some((option) => option.id === requestedAffiliate)
    ? requestedAffiliate
    : undefined

  // A GET never writes to the ledger: `listCommissions` reports and filters by
  // the *effective* status, so a matured `pending` commission already reads as
  // `available` without an UPDATE (and without a write for read-only members).
  const result = await withUser(user.id, (tx) =>
    listCommissions(tx, {
      workspaceId: workspace.id,
      environment,
      programId,
      affiliateId,
      statuses: status ? [status] : undefined,
      sort,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
  )

  const paging = pageWindow(page, result.total, PAGE_SIZE)
  const filtered = Boolean(status || programId || affiliateId)
  const billingConnected = integrations.some((integration) => integration.status === "connected")
  const integrationsHref = { pathname: "/[workspaceSlug]/integrations", params: { workspaceSlug } } as const
  const listHref = { pathname: "/[workspaceSlug]/commissions", params: { workspaceSlug } } as const
  const isDefaultSort = sort.field === SORT.defaultSort.field && sort.dir === SORT.defaultSort.dir
  const sortQuery = isDefaultSort ? {} : { sort: sort.field, dir: sort.dir }

  const hrefWith = (overrides: Record<string, string | number | undefined>) => {
    const merged: Record<string, string | number> = {}
    const all = { status, program: programId, affiliate: affiliateId, ...sortQuery, ...overrides }
    for (const [key, value] of Object.entries(all)) {
      if (value !== undefined && value !== "") merged[key] = value
    }
    return { ...listHref, query: merged }
  }
  const pageHref = (target: number) => hrefWith({ page: target > 1 ? target : undefined })
  const sortHref = (field: CommissionSortField) => {
    const next = nextSort(sort, field, field === "status" ? "asc" : "desc")
    return hrefWith({ sort: next.field, dir: next.dir, page: undefined })
  }
  const sorted = (field: CommissionSortField) => (sort.field === field ? sort.dir : false)
  const statusLabel = (value: CommissionStatus) => t(`statusLabel.${value}`)

  const firstRun = result.total === 0 && !filtered

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        meta={
          result.total > 0
            ? t("summary", {
                // One figure per currency, workspace default first; never summed.
                amount: formatMoneyTotalsInline(f.money, result.totals, workspace.defaultCurrency),
                count: result.total,
              })
            : null
        }
      />

      {firstRun ? null : (
        <FilterBar
          href={listHref}
          values={{ status, program: programId, affiliate: affiliateId }}
          preserve={sortQuery}
          submitLabel={t("apply")}
          label={t("filtersLabel")}
        >
          <Select
            name="affiliate"
            defaultValue={affiliateId ?? ""}
            aria-label={t("filterAffiliate")}
            className="w-auto min-w-44 max-w-full"
          >
            <option value="">{t("allAffiliates")}</option>
            {affiliateOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
          <Select
            name="status"
            defaultValue={status ?? ""}
            aria-label={t("filterStatus")}
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
          {filtered ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={{ ...listHref, query: sortQuery }}>
                <X aria-hidden="true" />
                {ta("clearFilters")}
              </Link>
            </Button>
          ) : null}
        </FilterBar>
      )}

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
          icon={Coins}
          title={filtered ? t("empty.filteredTitle") : t("empty.title")}
          description={
            filtered
              ? t("empty.filteredDescription")
              : billingConnected
                ? t("empty.descriptionConnected")
                : t("empty.description")
          }
          action={
            filtered ? (
              <Button asChild variant="secondary">
                <Link href={{ ...listHref, query: sortQuery }}>{ta("clearFilters")}</Link>
              </Button>
            ) : billingConnected ? (
              // Billing is already connected: nothing to connect, only to check.
              <Button asChild variant="secondary">
                <Link href={integrationsHref}>{ta("viewIntegrations")}</Link>
              </Button>
            ) : (
              <Button asChild variant="primary">
                <Link href={integrationsHref}>{ta("connectBilling")}</Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <TableContainer stickyFirstColumn>
            <Table className="min-w-5xl">
              <THead>
                <tr>
                  <TH>{tc("affiliate")}</TH>
                  <SortableHeader href={sortHref("date")} sorted={sorted("date")}>
                    {tc("date")}
                  </SortableHeader>
                  <TH>{tc("customer")}</TH>
                  <TH>{tc("transaction")}</TH>
                  <TH numeric>{tc("baseAmount")}</TH>
                  <TH numeric>
                    <Term definition={t("terms.rate")}>{tc("rate")}</Term>
                  </TH>
                  <SortableHeader href={sortHref("amount")} sorted={sorted("amount")} numeric>
                    {tc("commission")}
                  </SortableHeader>
                  <SortableHeader href={sortHref("status")} sorted={sorted("status")}>
                    {tc("status")}
                  </SortableHeader>
                  <TH>
                    <Term definition={t("terms.releasedOn")}>{tc("releasedOn")}</Term>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {result.rows.map((row) => (
                  <TR key={row.id}>
                    <TD className="whitespace-nowrap">
                      <Link
                        href={{
                          pathname: "/[workspaceSlug]/affiliates/[affiliateId]",
                          params: { workspaceSlug, affiliateId: row.affiliateId },
                        }}
                        className="block rounded-badge text-foreground hover:underline"
                      >
                        {row.affiliateName}
                      </Link>
                      <span className="block font-mono text-meta text-muted-foreground">
                        {row.affiliateCode}
                      </span>
                    </TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{f.date(row.occurredAt)}</TD>
                    <TD mono>
                      {/* A commission belongs to a conversion: the customer opens its path. */}
                      <Link
                        href={{
                          pathname: "/[workspaceSlug]/conversions/[conversionId]",
                          params: { workspaceSlug, conversionId: row.id },
                        }}
                        title={t("openTrail")}
                        className="rounded-badge text-foreground hover:underline"
                      >
                        {row.customerRef}
                      </Link>
                    </TD>
                    <TD mono className="max-w-40 truncate" title={row.transactionRef}>
                      {row.transactionRef}
                    </TD>
                    <TD numeric>{f.money(row.baseAmountMinor, row.currency)}</TD>
                    <TD numeric>
                      {row.commissionRate ? f.basisPoints(row.commissionRate) : t("fixed")}
                      {/* The engine's trace of the rule, read back into words. */}
                      {describeRuleApplied(row.ruleApplied, row.currency, f, trule) ? (
                        <span className="ml-auto block max-w-56 truncate text-meta text-muted-foreground">
                          {describeRuleApplied(row.ruleApplied, row.currency, f, trule)}
                        </span>
                      ) : null}
                    </TD>
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
                      <StatusBadge status={row.status} label={statusLabel(row.status)} />
                    </TD>
                    <TD className="whitespace-nowrap text-muted-foreground">
                      {f.date(row.eligibleAt)}
                    </TD>
                  </TR>
                ))}
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
