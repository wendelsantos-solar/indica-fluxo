import { Layers, Search, Users, X } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { Link } from "@/i18n/navigation"

import { EmptyState } from "@/components/feedback/empty-state"
import { getFormatters } from "@/i18n/format"
import { PageHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input, Select } from "@/components/ui/input"
import { Pagination } from "@/components/ui/pagination"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { AffiliateRowActions } from "@/features/affiliates/affiliate-row-actions"
import { InviteAffiliateDialog } from "@/features/affiliates/invite-affiliate-dialog"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listAffiliates } from "@/server/repositories/affiliates"
import { listPrograms } from "@/server/repositories/programs"
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

export default async function AffiliatesPage({
  params,
  searchParams,
}: PageProps<"/[locale]/[workspaceSlug]/affiliates">) {
  const t = await getTranslations("dashboard.affiliates")
  const tc = await getTranslations("common.table")
  const ta = await getTranslations("common.actions")
  const f = await getFormatters()
  const { workspaceSlug } = await params
  const query = await searchParams

  const search = typeof query.q === "string" && query.q.trim() !== "" ? query.q : undefined
  const status =
    typeof query.status === "string" && STATUSES.includes(query.status as ParticipationStatus)
      ? (query.status as ParticipationStatus)
      : undefined
  const page = Math.max(1, Number(query.page ?? 1) || 1)

  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)
  const programs = await withUser(user.id, (tx) => listPrograms(tx, workspace.id))

  // Only a program of this workspace narrows the list; anything else is ignored.
  const programId =
    typeof query.program === "string" && programs.some((program) => program.id === query.program)
      ? query.program
      : undefined

  const result = await withUser(user.id, (tx) =>
    listAffiliates(tx, {
      workspaceId: workspace.id,
      programId,
      search,
      status,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
  )

  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE))
  const filtered = Boolean(search || status || programId)
  const programOptions = programs.map((program) => ({ id: program.id, name: program.name }))
  const listHref = { pathname: "/[workspaceSlug]/affiliates", params: { workspaceSlug } } as const
  const pageHref = (target: number) =>
    ({
      ...listHref,
      query: {
        ...(search ? { q: search } : {}),
        ...(status ? { status } : {}),
        ...(programId ? { program: programId } : {}),
        page: target,
      },
    }) as const

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

  return (
    <>
      <PageHeader
        title={t("title")}
        meta={result.total > 0 ? f.number(result.total) : undefined}
        description={t("description")}
        actions={
          // On a first run the empty state carries the one primary action.
          result.total > 0 || filtered ? (
            <InviteAffiliateDialog
              workspaceSlug={workspaceSlug}
              programs={programOptions}
              defaultProgramId={programId}
            />
          ) : null
        }
      />

      {result.total > 0 || filtered ? (
        <form className="mb-3 flex flex-wrap items-center gap-2" role="search">
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
          <Button type="submit" variant="secondary" size="sm">
            {t("apply")}
          </Button>
          {filtered ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={listHref}>
                <X aria-hidden="true" />
                {ta("clearFilters")}
              </Link>
            </Button>
          ) : null}
        </form>
      ) : null}

      {result.rows.length === 0 ? (
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
              <InviteAffiliateDialog workspaceSlug={workspaceSlug} programs={programOptions} triggerSize="md" />
            )
          }
        />
      ) : (
        <>
          <TableContainer>
            <Table>
              <THead className="max-md:hidden">
                <tr>
                  <TH>{tc("affiliate")}</TH>
                  <TH className="max-lg:hidden">{tc("program")}</TH>
                  <TH>{tc("status")}</TH>
                  <TH numeric>{tc("clicks")}</TH>
                  <TH numeric className="max-lg:hidden">{tc("customers")}</TH>
                  <TH numeric className="max-lg:hidden">{tc("revenue")}</TH>
                  <TH numeric>{tc("commission")}</TH>
                  <TH numeric>{tc("conversion")}</TH>
                  {canManage ? (
                    <TH className="w-10">
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
                  const actions =
                    canManage && row.participationId && row.participationStatus && row.programName && row.currency ? (
                      <AffiliateRowActions
                        workspaceSlug={workspaceSlug}
                        participationId={row.participationId}
                        affiliateName={row.name}
                        programName={row.programName}
                        status={row.participationStatus}
                        currency={row.currency}
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
                      />
                    ) : null
                  return (
                    <TR key={`${row.affiliateId}-${row.participationId ?? "none"}`}>
                      <TD className="max-md:py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate font-medium text-foreground">{row.name}</span>
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
                      {canManage ? <TD className="w-10 text-right">{actions}</TD> : null}
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </TableContainer>

          {pages > 1 ? (
            <Pagination
              label={t("pagination")}
              summary={t("pageOf", { page, pages, total: f.number(result.total) })}
              previous={page > 1 ? <Link href={pageHref(page - 1)} /> : null}
              next={page < pages ? <Link href={pageHref(page + 1)} /> : null}
              previousLabel={ta("previous")}
              nextLabel={ta("next")}
            />
          ) : null}
        </>
      )}
    </>
  )
}
