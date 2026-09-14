import { Coins } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { Link } from "@/i18n/navigation"

import { EmptyState } from "@/components/feedback/empty-state"
import { getFormatters } from "@/i18n/format"
import { PageHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        meta={
          result.total > 0 ? (
            <span className="text-caption tabular-nums text-muted-foreground">
              {t("summary", {
                amount: f.money(result.totalAmountMinor, workspace.defaultCurrency),
                count: f.number(result.total),
              })}
            </span>
          ) : null
        }
      />

      <form className="mb-4 flex flex-wrap items-center gap-2">
        <Select name="status" defaultValue={status ?? ""} aria-label={t("filterStatus")} className="w-auto min-w-[150px]">
          <option value="">{t("allStatuses")}</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {ts(value)}
            </option>
          ))}
        </Select>
        <Select name="program" defaultValue={programId ?? ""} aria-label={t("filterProgram")} className="w-auto min-w-[180px]">
          <option value="">{t("allPrograms")}</option>
          {programs.map((program) => (
            <option key={program.id} value={program.id}>
              {program.name}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          {t("apply")}
        </Button>
      </form>

      {result.rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Coins}
            title={status || programId ? t("empty.filteredTitle") : t("empty.title")}
            description={
              status || programId ? t("empty.filteredDescription") : t("empty.description")
            }
            action={
              status || programId ? (
                <Button asChild variant="secondary">
                  <Link href={{ pathname: "/[workspaceSlug]/commissions", params: { workspaceSlug: workspaceSlug } }}>{ta("clearFilters")}</Link>
                </Button>
              ) : (
                <Button asChild variant="primary">
                  <Link href={{ pathname: "/[workspaceSlug]/integrations", params: { workspaceSlug: workspaceSlug } }}>{ta("connectBilling")}</Link>
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <>
          <TableContainer scrollable>
            <Table>
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
                  <TR key={row.id} interactive>
                    <TD>
                      <span className="block text-foreground">{row.affiliateName}</span>
                      <span className="block font-mono text-label text-muted-foreground">
                        {row.affiliateCode}
                      </span>
                    </TD>
                    <TD mono>{row.customerRef}</TD>
                    <TD mono className="max-w-[160px] truncate">
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
                    <TD className="text-muted-foreground">
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
              className="mt-3 flex items-center justify-between text-meta text-muted-foreground"
            >
              <span>{t("pageOf", { page, pages })}</span>
              <span className="flex gap-2">
                <Button asChild variant="secondary" size="sm" disabled={page <= 1}>
                  <Link href={{ pathname: "/[workspaceSlug]/commissions", params: { workspaceSlug: workspaceSlug }, query: { page: page - 1 } }}>{ta("previous")}</Link>
                </Button>
                <Button asChild variant="secondary" size="sm" disabled={page >= pages}>
                  <Link href={{ pathname: "/[workspaceSlug]/commissions", params: { workspaceSlug: workspaceSlug }, query: { page: page + 1 } }}>{ta("next")}</Link>
                </Button>
              </span>
            </nav>
          ) : null}
        </>
      )}
    </>
  )
}
