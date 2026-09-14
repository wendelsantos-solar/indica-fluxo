import { Search, Users } from "lucide-react"
import type { Metadata } from "next"
import { Link } from "@/i18n/navigation"

import { EmptyState } from "@/components/feedback/empty-state"
import { getFormatters } from "@/i18n/format"
import { PageHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input, Select } from "@/components/ui/input"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { InviteAffiliateDialog } from "@/features/affiliates/invite-affiliate-dialog"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listAffiliates } from "@/server/repositories/affiliates"
import { listPrograms } from "@/server/repositories/programs"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const metadata: Metadata = { title: "Affiliates" }
export const dynamic = "force-dynamic"

const PAGE_SIZE = 25

export default async function AffiliatesPage({
  params,
  searchParams,
}: PageProps<"/[locale]/[workspaceSlug]/affiliates">) {
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

  return (
    <>
      <PageHeader
        title="Affiliates"
        description="Everyone promoting your product, and what each one has earned."
        actions={
          <InviteAffiliateDialog
            workspaceSlug={workspaceSlug}
            programs={programs.map((program) => ({ id: program.id, name: program.name }))}
          />
        }
      />

      <form className="mb-4 flex flex-wrap items-center gap-2" role="search">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            name="q"
            defaultValue={search}
            placeholder="Search name, e-mail or code"
            aria-label="Search affiliates"
            className="pl-8"
          />
        </div>
        <Select name="status" defaultValue={status ?? ""} aria-label="Filter by status" className="w-auto min-w-[150px]">
          <option value="">All statuses</option>
          <option value="approved">Approved</option>
          <option value="pending">Pending</option>
          <option value="suspended">Suspended</option>
          <option value="rejected">Rejected</option>
        </Select>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </form>

      {result.rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title={search || status ? "No affiliates match those filters" : "No affiliates yet"}
            description={
              search || status
                ? "Try a different search term, or clear the status filter."
                : "Invite your first affiliate and they will get a referral link straight away."
            }
            action={
              search || status ? (
                <Button asChild variant="secondary">
                  <Link href={{ pathname: "/[workspaceSlug]/affiliates", params: { workspaceSlug: workspaceSlug } }}>Clear filters</Link>
                </Button>
              ) : (
                <InviteAffiliateDialog
                  workspaceSlug={workspaceSlug}
                  programs={programs.map((program) => ({ id: program.id, name: program.name }))}
                  triggerLabel="Invite your first affiliate"
                />
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
                  <TH>Program</TH>
                  <TH>Status</TH>
                  <TH numeric>Clicks</TH>
                  <TH numeric>Customers</TH>
                  <TH numeric>Revenue</TH>
                  <TH numeric>Commission</TH>
                  <TH numeric>Conversion</TH>
                </tr>
              </THead>
              <TBody>
                {result.rows.map((row) => (
                  <TR key={`${row.affiliateId}-${row.participationId ?? "none"}`} interactive>
                    <TD>
                      <span className="block font-medium text-foreground">{row.name}</span>
                      <span className="block font-mono text-label text-muted-foreground">
                        {row.code ?? row.email}
                      </span>
                    </TD>
                    <TD>{row.programName ?? "—"}</TD>
                    <TD>
                      <StatusBadge status={row.participationStatus ?? row.status} />
                    </TD>
                    <TD numeric>{f.number(row.clicks)}</TD>
                    <TD numeric>{f.number(row.customers)}</TD>
                    <TD numeric>{f.money(row.revenueMinor, workspace.defaultCurrency)}</TD>
                    <TD numeric className="text-foreground">
                      {f.money(row.commissionMinor, workspace.defaultCurrency)}
                    </TD>
                    <TD numeric>{f.rate(row.customers, row.clicks)}</TD>
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
                Page {page} of {pages} · {f.number(result.total)} affiliates
              </span>
              <span className="flex gap-2">
                <Button asChild variant="secondary" size="sm" disabled={page <= 1}>
                  <Link href={{ pathname: "/[workspaceSlug]/affiliates", params: { workspaceSlug: workspaceSlug }, query: { page: page - 1 } }}>Previous</Link>
                </Button>
                <Button asChild variant="secondary" size="sm" disabled={page >= pages}>
                  <Link href={{ pathname: "/[workspaceSlug]/affiliates", params: { workspaceSlug: workspaceSlug }, query: { page: page + 1 } }}>Next</Link>
                </Button>
              </span>
            </nav>
          ) : null}
        </>
      )}
    </>
  )
}
