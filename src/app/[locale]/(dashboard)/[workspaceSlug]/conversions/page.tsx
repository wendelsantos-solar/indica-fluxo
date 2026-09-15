import { Receipt, SearchX, X } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { Link } from "@/i18n/navigation"

import { EmptyState } from "@/components/feedback/empty-state"
import { getFormatters } from "@/i18n/format"
import { PageHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FilterBar } from "@/components/ui/filter-bar"
import { Select } from "@/components/ui/input"
import { Pagination } from "@/components/ui/pagination"
import { SortableHeader } from "@/components/ui/sortable-header"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import {
  firstParam,
  nextSort,
  pageWindow,
  parsePage,
  parsePeriod,
  parseSort,
  parseUuidParam,
  periodStartInZone,
  PERIODS,
  type SortState,
} from "@/lib/list-params"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listAffiliateOptions } from "@/server/repositories/affiliates"
import { listConversions, type ConversionSortField } from "@/server/repositories/analytics"
import { listPrograms } from "@/server/repositories/programs"
import { listIntegrations } from "@/server/services/integrations"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/[workspaceSlug]/conversions">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.conversions" })
  return { title: t("title") }
}

const PAGE_SIZE = 50

const SORT = {
  fields: ["date", "amount"] as const satisfies readonly ConversionSortField[],
  defaultSort: { field: "date", dir: "desc" } as SortState<ConversionSortField>,
}

export default async function ConversionsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/[workspaceSlug]/conversions">) {
  const t = await getTranslations("dashboard.conversions")
  const tc = await getTranslations("common.table")
  const ta = await getTranslations("common.actions")
  const tp = await getTranslations("common.pagination")
  const tperiod = await getTranslations("common.period")
  const tcs = await getTranslations("dashboard.commissions.statusLabel")
  const { workspaceSlug } = await params
  const query = await searchParams

  const page = parsePage(query.page)
  const sort = parseSort(query, SORT)
  const period = parsePeriod(query.period)
  const requestedAffiliate = parseUuidParam(query.affiliate)

  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)
  const f = await getFormatters(workspace.timezone)

  const { programs, affiliateOptions, integrations } = await withUser(user.id, async (tx) => ({
    programs: await listPrograms(tx, workspace.id),
    affiliateOptions: await listAffiliateOptions(tx, workspace.id, { include: requestedAffiliate }),
    integrations: await listIntegrations(tx, workspace.id),
  }))

  // Only ids of this workspace narrow the list; anything else is ignored.
  const rawProgram = firstParam(query.program)
  const programId = programs.some((program) => program.id === rawProgram) ? rawProgram : undefined
  const affiliateId = affiliateOptions.some((option) => option.id === requestedAffiliate)
    ? requestedAffiliate
    : undefined

  const result = await withUser(user.id, (tx) =>
    listConversions(tx, {
      workspaceId: workspace.id,
      affiliateId,
      programId,
      // "Last 7 days" counts the workspace's calendar days, from local midnight.
      from: period ? periodStartInZone(period, new Date(), f.timeZone) : undefined,
      sort,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
  )

  const paging = pageWindow(page, result.total, PAGE_SIZE)
  const filtered = Boolean(affiliateId || programId || period)
  const billingConnected = integrations.some((integration) => integration.status === "connected")
  const integrationsHref = { pathname: "/[workspaceSlug]/integrations", params: { workspaceSlug } } as const
  const listHref = { pathname: "/[workspaceSlug]/conversions", params: { workspaceSlug } } as const
  const isDefaultSort = sort.field === SORT.defaultSort.field && sort.dir === SORT.defaultSort.dir
  const sortQuery = isDefaultSort ? {} : { sort: sort.field, dir: sort.dir }

  const hrefWith = (overrides: Record<string, string | number | undefined>) => {
    const merged: Record<string, string | number> = {}
    const all = { affiliate: affiliateId, program: programId, period, ...sortQuery, ...overrides }
    for (const [key, value] of Object.entries(all)) {
      if (value !== undefined && value !== "") merged[key] = value
    }
    return { ...listHref, query: merged }
  }
  const pageHref = (target: number) => hrefWith({ page: target > 1 ? target : undefined })
  const sortHref = (field: ConversionSortField) => {
    const next = nextSort(sort, field)
    return hrefWith({ sort: next.field, dir: next.dir, page: undefined })
  }
  const sorted = (field: ConversionSortField) => (sort.field === field ? sort.dir : false)
  const selectedAffiliate = affiliateOptions.find((option) => option.id === affiliateId)

  // A workspace that has never had a conversion gets the first-run state, not filters.
  const firstRun = result.total === 0 && !filtered

  return (
    <>
      <PageHeader
        title={t("title")}
        meta={result.total === 0 ? undefined : f.number(result.total)}
        description={t("description")}
      />

      {firstRun ? null : (
        <FilterBar
          href={listHref}
          values={{ affiliate: affiliateId, program: programId, period }}
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
          <Select
            name="period"
            defaultValue={period ?? ""}
            aria-label={t("filterPeriod")}
            className="w-auto min-w-40"
          >
            <option value="">{tperiod("all")}</option>
            {PERIODS.map((value) => (
              <option key={value} value={value}>
                {tperiod(value)}
              </option>
            ))}
          </Select>
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

      {firstRun ? (
        <EmptyState
          icon={Receipt}
          title={t("empty.title")}
          description={billingConnected ? t("empty.descriptionConnected") : t("empty.description")}
          action={
            // Only offer to connect billing when it is not connected yet.
            billingConnected ? (
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
      ) : paging.pastEnd ? (
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
          icon={Receipt}
          title={t("empty.filteredTitle")}
          description={
            selectedAffiliate
              ? t("empty.filteredAffiliateDescription", { name: selectedAffiliate.name })
              : t("empty.filteredDescription")
          }
          action={
            <Button asChild variant="secondary">
              <Link href={{ ...listHref, query: sortQuery }}>{ta("clearFilters")}</Link>
            </Button>
          }
        />
      ) : (
        <>
          <TableContainer stickyFirstColumn>
            <Table className="min-w-3xl">
              <THead>
                <tr>
                  <SortableHeader href={sortHref("date")} sorted={sorted("date")}>
                    {tc("date")}
                  </SortableHeader>
                  <TH>{tc("affiliate")}</TH>
                  {programs.length > 1 ? <TH>{tc("program")}</TH> : null}
                  <TH>{tc("customer")}</TH>
                  <SortableHeader href={sortHref("amount")} sorted={sorted("amount")} numeric>
                    {tc("baseAmount")}
                  </SortableHeader>
                  <TH numeric>{tc("commission")}</TH>
                  <TH>{tc("status")}</TH>
                </tr>
              </THead>
              <TBody>
                {result.rows.map((conversion) => (
                  <TR key={conversion.id}>
                    <TD className="whitespace-nowrap text-muted-foreground">{f.date(conversion.occurredAt)}</TD>
                    <TD className="whitespace-nowrap">
                      <Link
                        href={{
                          pathname: "/[workspaceSlug]/affiliates/[affiliateId]",
                          params: { workspaceSlug, affiliateId: conversion.affiliateId },
                        }}
                        className="rounded-badge text-foreground hover:underline"
                      >
                        {conversion.affiliateName}
                      </Link>
                    </TD>
                    {programs.length > 1 ? (
                      <TD className="whitespace-nowrap">{conversion.programName}</TD>
                    ) : null}
                    <TD mono>
                      {/* The customer opens this conversion's path, click to commission. */}
                      <Link
                        href={{
                          pathname: "/[workspaceSlug]/conversions/[conversionId]",
                          params: { workspaceSlug, conversionId: conversion.id },
                        }}
                        title={t("openTrail")}
                        className="rounded-badge text-foreground hover:underline"
                      >
                        {conversion.customerRef}
                      </Link>
                    </TD>
                    <TD numeric>{f.money(conversion.amountMinor, conversion.currency)}</TD>
                    <TD
                      numeric
                      className={conversion.commissionMinor < 0 ? "text-danger-foreground" : "text-foreground"}
                    >
                      {f.money(conversion.commissionMinor, conversion.currency, {
                        signDisplay: conversion.commissionMinor < 0 ? "always" : "auto",
                      })}
                    </TD>
                    <TD>
                      <StatusBadge status={conversion.status} label={tcs(conversion.status)} />
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
