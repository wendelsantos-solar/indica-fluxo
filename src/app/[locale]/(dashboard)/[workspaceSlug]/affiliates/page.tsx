import { Search, Users, X } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { Link } from "@/i18n/navigation"

import { EmptyState } from "@/components/feedback/empty-state"
import { getFormatters } from "@/i18n/format"
import { PageHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input, Select } from "@/components/ui/input"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
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

export default async function AffiliatesPage({
  params,
  searchParams,
}: PageProps<"/[locale]/[workspaceSlug]/affiliates">) {
  const t = await getTranslations("dashboard.affiliates")
  const tc = await getTranslations("common.table")
  const ts = await getTranslations("status")
  const ta = await getTranslations("common.actions")
  const f = await getFormatters()
  const { workspaceSlug } = await params
  const query = await searchParams

  const search = typeof query.q === "string" ? query.q : undefined
  const status =
    typeof query.status === "string" &&
    ["pending", "approved", "rejected", "suspended"].includes(query.status)
      ? (query.status as "pending" | "approved" | "rejected" | "suspended")
      : undefined
  const page = Math.max(1, Number(query.page ?? 1) || 1)

  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)

  const [programs, result] = await withUser(user.id, (tx) =>
    Promise.all([
      listPrograms(tx, workspace.id),
      listAffiliates(tx, {
        workspaceId: workspace.id,
        search,
        status,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
    ]),
  )

  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE))
  const filtered = Boolean(search || status)
  const programOptions = programs.map((program) => ({ id: program.id, name: program.name }))
  const pageHref = (target: number) =>
    ({
      pathname: "/[workspaceSlug]/affiliates",
      params: { workspaceSlug },
      query: { ...(search ? { q: search } : {}), ...(status ? { status } : {}), page: target },
    }) as const

  return (
    <>
      <PageHeader
        title={t("title")}
        meta={result.total > 0 ? f.number(result.total) : undefined}
        description={t("description")}
        actions={
          // On a first run the empty state carries the one primary action.
          result.total > 0 || filtered ? (
            <InviteAffiliateDialog workspaceSlug={workspaceSlug} programs={programOptions} />
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
            <option value="approved">{ts("approved")}</option>
            <option value="pending">{ts("pending")}</option>
            <option value="suspended">{ts("suspended")}</option>
            <option value="rejected">{ts("rejected")}</option>
          </Select>
          <Button type="submit" variant="secondary" size="sm">
            {t("apply")}
          </Button>
          {filtered ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={{ pathname: "/[workspaceSlug]/affiliates", params: { workspaceSlug } }}>
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
                <Link href={{ pathname: "/[workspaceSlug]/affiliates", params: { workspaceSlug } }}>
                  {ta("clearFilters")}
                </Link>
              </Button>
            ) : (
              <InviteAffiliateDialog
                workspaceSlug={workspaceSlug}
                programs={programOptions}
                triggerLabel={t("empty.action")}
                triggerSize="md"
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
                  <TH>{tc("affiliate")}</TH>
                  <TH className="max-lg:hidden">{tc("program")}</TH>
                  <TH>{tc("status")}</TH>
                  <TH numeric>{tc("clicks")}</TH>
                  <TH numeric className="max-lg:hidden">{tc("customers")}</TH>
                  <TH numeric className="max-lg:hidden">{tc("revenue")}</TH>
                  <TH numeric>{tc("commission")}</TH>
                  <TH numeric>{tc("conversion")}</TH>
                </tr>
              </THead>
              <TBody>
                {result.rows.map((row) => {
                  const rowStatus = row.participationStatus ?? row.status
                  const commission = f.money(row.commissionMinor, workspace.defaultCurrency)
                  return (
                    <TR key={`${row.affiliateId}-${row.participationId ?? "none"}`}>
                      <TD className="max-md:py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate font-medium text-foreground">{row.name}</span>
                          <StatusBadge status={rowStatus} className="md:hidden" />
                        </div>
                        <span className="block truncate font-mono text-label text-muted-foreground max-md:hidden">
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
                          <span className="ml-auto shrink-0 tabular-nums text-foreground-secondary">
                            {commission}
                          </span>
                        </span>
                      </TD>
                      <TD className="max-lg:hidden">{row.programName ?? "—"}</TD>
                      <TD className="max-md:hidden">
                        <StatusBadge status={rowStatus} />
                      </TD>
                      <TD numeric className="max-md:hidden">
                        {f.number(row.clicks)}
                      </TD>
                      <TD numeric className="max-lg:hidden">
                        {f.number(row.customers)}
                      </TD>
                      <TD numeric className="max-lg:hidden">
                        {f.money(row.revenueMinor, workspace.defaultCurrency)}
                      </TD>
                      <TD numeric className="text-foreground max-md:hidden">
                        {commission}
                      </TD>
                      <TD numeric className="max-md:hidden">
                        {f.rate(row.customers, row.clicks)}
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </TableContainer>

          {pages > 1 ? (
            <nav
              aria-label={t("pagination")}
              className="flex h-12 items-center justify-between gap-3 text-meta tabular-nums text-muted-foreground"
            >
              <span>{t("pageOf", { page, pages, total: f.number(result.total) })}</span>
              <span className="flex gap-2">
                {page <= 1 ? (
                  <Button variant="secondary" size="sm" disabled>
                    {ta("previous")}
                  </Button>
                ) : (
                  <Button asChild variant="secondary" size="sm">
                    <Link href={pageHref(page - 1)}>{ta("previous")}</Link>
                  </Button>
                )}
                {page >= pages ? (
                  <Button variant="secondary" size="sm" disabled>
                    {ta("next")}
                  </Button>
                ) : (
                  <Button asChild variant="secondary" size="sm">
                    <Link href={pageHref(page + 1)}>{ta("next")}</Link>
                  </Button>
                )}
              </span>
            </nav>
          ) : null}
        </>
      )}
    </>
  )
}
