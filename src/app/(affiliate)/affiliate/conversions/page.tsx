import { Receipt } from "lucide-react"
import type { Metadata } from "next"

import { EmptyState } from "@/components/feedback/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { formatMoney } from "@/lib/money"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listParticipationsForUser } from "@/server/repositories/affiliates"
import { listCommissionsForAffiliate } from "@/server/repositories/commissions"

export const metadata: Metadata = { title: "Conversions" }
export const dynamic = "force-dynamic"

export default async function AffiliateConversionsPage() {
  const user = await requireUser()

  const rows = await withUser(user.id, async (tx) => {
    const participations = await listParticipationsForUser(tx, user.id)
    return listCommissionsForAffiliate(
      tx,
      participations.map((participation) => participation.participationId),
    )
  })

  const conversions = rows.filter((row) => row.commissionAmountMinor > 0)

  return (
    <>
      <PageHeader
        title="Conversions"
        description="Customers who signed up through your link and paid."
      />

      {conversions.length === 0 ? (
        <Card>
          <EmptyState
            icon={Receipt}
            title="No conversions yet"
            description="A conversion is recorded when someone who clicked your link becomes a paying customer."
          />
        </Card>
      ) : (
        <TableContainer scrollable>
          <Table>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Program</TH>
                <TH>Customer</TH>
                <TH numeric>Sale</TH>
                <TH numeric>Your commission</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <TBody>
              {conversions.map((row) => (
                <TR key={row.id}>
                  <TD className="text-muted-foreground">
                    {row.createdAt.toISOString().slice(0, 10)}
                  </TD>
                  <TD>{row.programName}</TD>
                  <TD mono>{row.customerRef}</TD>
                  <TD numeric>{formatMoney(row.baseAmountMinor, row.currency)}</TD>
                  <TD numeric className="font-medium text-foreground">
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
      )}
    </>
  )
}
