import { Coins } from "lucide-react"
import type { Metadata } from "next"
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

export const metadata: Metadata = { title: "Commissions" }
export const dynamic = "force-dynamic"

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
        title="Commissions"
        description="Every commission the engine has calculated, with the rule that produced it."
        meta={
          result.total > 0 ? (
            <span className="text-caption tabular-nums text-muted-foreground">
              {f.money(result.totalAmountMinor, workspace.defaultCurrency)} across{" "}
              {f.number(result.total)} entries
            </span>
          ) : null
        }
      />

      <form className="mb-4 flex flex-wrap items-center gap-2">
        <Select name="status" defaultValue={status ?? ""} aria-label="Filter by status" className="w-auto min-w-[150px]">
          <option value="">All statuses</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {value.charAt(0).toUpperCase() + value.slice(1)}
            </option>
          ))}
        </Select>
        <Select name="program" defaultValue={programId ?? ""} aria-label="Filter by program" className="w-auto min-w-[180px]">
          <option value="">All programs</option>
          {programs.map((program) => (
            <option key={program.id} value={program.id}>
              {program.name}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </form>

      {result.rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Coins}
            title={status || programId ? "No commissions match those filters" : "No commissions yet"}
            description={
              status || programId
                ? "Try a different status or program."
                : "Commissions appear the moment a tracked customer pays and your billing webhook fires."
            }
            action={
              status || programId ? (
                <Button asChild variant="secondary">
                  <Link href={{ pathname: "/[workspaceSlug]/commissions", params: { workspaceSlug: workspaceSlug } }}>Clear filters</Link>
                </Button>
              ) : (
                <Button asChild variant="primary">
                  <Link href={{ pathname: "/[workspaceSlug]/integrations", params: { workspaceSlug: workspaceSlug } }}>Connect billing</Link>
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
                  <TH>Affiliate</TH>
                  <TH>Customer</TH>
                  <TH>Transaction</TH>
                  <TH numeric>Base</TH>
                  <TH numeric>Rate</TH>
                  <TH numeric>Commission</TH>
                  <TH>Status</TH>
                  <TH>Eligible</TH>
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
                      {row.commissionRate ? f.basisPoints(row.commissionRate) : "Fixed"}
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
                      {row.eligibleAt.toISOString().slice(0, 10)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>

          {pages > 1 ? (
            <nav
              aria-label="Pagination"
              className="mt-3 flex items-center justify-between text-meta text-muted-foreground"
            >
              <span>
                Page {page} of {pages}
              </span>
              <span className="flex gap-2">
                <Button asChild variant="secondary" size="sm" disabled={page <= 1}>
                  <Link href={{ pathname: "/[workspaceSlug]/commissions", params: { workspaceSlug: workspaceSlug }, query: { page: page - 1 } }}>Previous</Link>
                </Button>
                <Button asChild variant="secondary" size="sm" disabled={page >= pages}>
                  <Link href={{ pathname: "/[workspaceSlug]/commissions", params: { workspaceSlug: workspaceSlug }, query: { page: page + 1 } }}>Next</Link>
                </Button>
              </span>
            </nav>
          ) : null}
        </>
      )}
    </>
  )
}
