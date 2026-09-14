import { Coins } from "lucide-react"
import type { Metadata } from "next"

import { EmptyState } from "@/components/feedback/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { formatBasisPoints, formatMoney } from "@/lib/money"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listParticipationsForUser } from "@/server/repositories/affiliates"
import { listCommissionsForAffiliate } from "@/server/repositories/commissions"

export const metadata: Metadata = { title: "Commissions" }
export const dynamic = "force-dynamic"

export default async function AffiliateCommissionsPage() {
  const user = await requireUser()

  const rows = await withUser(user.id, async (tx) => {
    const participations = await listParticipationsForUser(tx, user.id)
    return listCommissionsForAffiliate(
      tx,
      participations.map((participation) => participation.participationId),
    )
  })

  return (
    <>
      <PageHeader
        title="Commissions"
        description="Everything you have earned, and where each commission is in the payout cycle."
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Coins}
            title="No commissions yet"
            description="Share your referral link. Commissions appear here the moment a referred customer pays."
          />
        </Card>
      ) : (
        <>
          {/* Desktop: the full financial table. */}
          <TableContainer scrollable className="hidden sm:block">
            <Table>
              <THead>
                <tr>
                  <TH>Date</TH>
                  <TH>Program</TH>
                  <TH>Customer</TH>
                  <TH numeric>Sale</TH>
                  <TH numeric>Rate</TH>
                  <TH numeric>Commission</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id}>
                    <TD className="text-muted-foreground">
                      {row.createdAt.toISOString().slice(0, 10)}
                    </TD>
                    <TD>{row.programName}</TD>
                    <TD mono>{row.customerRef}</TD>
                    <TD numeric>{formatMoney(row.baseAmountMinor, row.currency)}</TD>
                    <TD numeric>
                      {row.commissionRate ? formatBasisPoints(row.commissionRate) : "Fixed"}
                    </TD>
                    <TD
                      numeric
                      className={
                        row.commissionAmountMinor < 0
                          ? "font-medium text-danger-foreground"
                          : "font-medium text-foreground"
                      }
                    >
                      {formatMoney(row.commissionAmountMinor, row.currency)}
                    </TD>
                    <TD>
                      <StatusBadge status={row.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>

          {/* Mobile: one card per commission — spec §41. */}
          <ul className="space-y-2 sm:hidden">
            {rows.map((row) => (
              <li key={row.id}>
                <Card>
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-caption font-medium text-foreground">
                          {row.programName}
                        </p>
                        <p className="font-mono text-label text-muted-foreground">
                          {row.customerRef}
                        </p>
                      </div>
                      <StatusBadge status={row.status} />
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-meta text-muted-foreground">
                        {row.createdAt.toISOString().slice(0, 10)} ·{" "}
                        {formatMoney(row.baseAmountMinor, row.currency)} sale
                      </span>
                      <span className="text-body-sm font-medium tabular-nums text-foreground">
                        {formatMoney(row.commissionAmountMinor, row.currency)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
