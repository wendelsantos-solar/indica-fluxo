import { Coins, X } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { Link } from "@/i18n/navigation"

import { EmptyState } from "@/components/feedback/empty-state"
import { getFormatters } from "@/i18n/format"
import { PageHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/input"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import {
  listCommissions,
  promoteEligibleCommissions,
  type CommissionStatus,
} from "@/server/repositories/commissions"
import { listPrograms } from "@/server/repositories/programs"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/[workspaceSlug]/commissions">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.commissions" })
  return { title: t("title") }
}

const STATUSES: CommissionStatus[] = [
  "pending",
  "available",
  "approved",
  "paid",
  "reversed",
  "rejected",
]

const PAGE_SIZE = 50

export default async function CommissionsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/[workspaceSlug]/commissions">) {
  const t = await getTranslations("dashboard.commissions")
  const tc = await getTranslations("common.table")
  const ta = await getTranslations("common.actions")
  const ts = await getTranslations("status")
  const f = await getFormatters()
  const { workspaceSlug } = await params
  const query = await searchParams

  const status =
    typeof query.status === "string" && STATUSES.includes(query.status as CommissionStatus)
      ? (query.status as CommissionStatus)
      : undefined
  const programId = typeof query.program === "string" ? query.program : undefined
  const page = Math.max(1, Number(query.page ?? 1) || 1)

  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)

  const { programs, result } = await withUser(user.id, async (tx) => {
    // `pending → available` is a pure function of the clock, so promote lazily
    // on read instead of running a worker. Idempotent by construction.
    await promoteEligibleCommissions(tx, workspace.id)

    return {
      programs: await listPrograms(tx, workspace.id),
      result: await listCommissions(tx, {
        workspaceId: workspace.id,
        programId,
        statuses: status ? [status] : undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
    }
  })

  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE))
  const filtered = Boolean(status || programId)
  const clearHref = { pathname: "/[workspaceSlug]/commissions", params: { workspaceSlug } } as const
  const pageHref = (target: number) =>
    ({
      ...clearHref,
      query: {
        ...(status ? { status } : {}),
        ...(programId ? { program: programId } : {}),
        page: target,
      },
    }) as const

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        meta={
          result.total > 0
            ? t("summary", {
                amount: f.money(result.totalAmountMinor, workspace.defaultCurrency),
                count: f.number(result.total),
              })
            : null
        }
      />

      {result.total > 0 || filtered ? (
        <form className="mb-3 flex flex-wrap items-center gap-2">
          <Select
            name="status"
            defaultValue={status ?? ""}
            aria-label={t("filterStatus")}
            className="w-auto min-w-40"
          >
            <option value="">{t("allStatuses")}</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {ts(value)}
              </option>
            ))}
          </Select>
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
          <Button type="submit" variant="secondary" size="sm">
            {t("apply")}
          </Button>
          {filtered ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={clearHref}>
                <X aria-hidden="true" />
                {ta("clearFilters")}
              </Link>
            </Button>
          ) : null}
        </form>
      ) : null}

      {result.rows.length === 0 ? (
        <EmptyState
          icon={Coins}
          title={filtered ? t("empty.filteredTitle") : t("empty.title")}
          description={filtered ? t("empty.filteredDescription") : t("empty.description")}
          action={
            filtered ? (
              <Button asChild variant="secondary">
                <Link href={clearHref}>{ta("clearFilters")}</Link>
              </Button>
            ) : (
              <Button asChild variant="primary">
                <Link href={{ pathname: "/[workspaceSlug]/integrations", params: { workspaceSlug } }}>
                  {ta("connectBilling")}
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <TableContainer scrollable>
            <Table className="min-w-4xl">
              <THead>
                <tr>
                  <TH>{tc("affiliate")}</TH>
                  <TH>{tc("customer")}</TH>
                  <TH>{tc("transaction")}</TH>
                  <TH numeric>{tc("base")}</TH>
                  <TH numeric>{tc("rate")}</TH>
                  <TH numeric>{tc("commission")}</TH>
                  <TH>{tc("status")}</TH>
                  <TH>{tc("eligible")}</TH>
                </tr>
              </THead>
              <TBody>
                {result.rows.map((row) => (
                  <TR key={row.id}>
                    <TD className="whitespace-nowrap">
                      <span className="block text-foreground">{row.affiliateName}</span>
                      <span className="block font-mono text-label text-muted-foreground">
                        {row.affiliateCode}
                      </span>
                    </TD>
                    <TD mono>{row.customerRef}</TD>
                    <TD mono className="max-w-40 truncate" title={row.transactionRef}>
                      {row.transactionRef}
                    </TD>
                    <TD numeric>{f.money(row.baseAmountMinor, row.currency)}</TD>
                    <TD numeric>
                      {row.commissionRate ? f.basisPoints(row.commissionRate) : t("fixed")}
                    </TD>
                    <TD
                      numeric
                      className={
                        row.commissionAmountMinor < 0
                          ? "font-medium text-danger-foreground"
                          : "font-medium text-foreground"
                      }
                    >
                      {f.money(row.commissionAmountMinor, row.currency, {
                        signDisplay: row.commissionAmountMinor < 0 ? "always" : "auto",
                      })}
                    </TD>
                    <TD>
                      <StatusBadge status={row.status} />
                    </TD>
                    <TD className="whitespace-nowrap text-muted-foreground">
                      {f.date(row.eligibleAt)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>

          {pages > 1 ? (
            <nav
              aria-label={t("pagination")}
              className="flex h-12 items-center justify-between gap-3 text-meta tabular-nums text-muted-foreground"
            >
              <span>{t("pageOf", { page, pages })}</span>
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
