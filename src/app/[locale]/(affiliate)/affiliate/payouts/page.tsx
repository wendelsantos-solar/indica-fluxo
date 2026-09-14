import { CreditCard } from "lucide-react"
import type { Metadata } from "next"

import { EmptyState } from "@/components/feedback/empty-state"
import { getFormatters } from "@/i18n/format"
import { PageHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listParticipationsForUser } from "@/server/repositories/affiliates"
import { listPayoutsForAffiliate } from "@/server/repositories/commissions"

export const metadata: Metadata = { title: "Payouts" }
export const dynamic = "force-dynamic"

export default async function AffiliatePayoutsPage() {
  const f = await getFormatters()
  const user = await requireUser()

  const rows = await withUser(user.id, async (tx) => {
    const participations = await listParticipationsForUser(tx, user.id)
    return listPayoutsForAffiliate(
      tx,
      participations.map((participation) => participation.participationId),
    )
  })

  return (
    <>
      <PageHeader
        title="Payout history"
        description="Payments are sent by the program owner outside Indica. This is the record of what they marked as paid."
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={CreditCard}
            title="No payouts yet"
            description="Once your commissions clear their hold period and the program owner runs a payout, it appears here."
          />
        </Card>
      ) : (
        <TableContainer scrollable>
          <Table>
            <THead>
              <tr>
                <TH>Batch</TH>
                <TH numeric>Amount</TH>
                <TH>Status</TH>
                <TH>Paid</TH>
                <TH>Reference</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TR key={row.id}>
                  <TD className="text-foreground">{row.reference}</TD>
                  <TD numeric className="font-medium text-foreground">
                    {f.money(row.amountMinor, row.currency)}
                  </TD>
                  <TD>
                    <StatusBadge status={row.status} />
                  </TD>
                  <TD className="text-muted-foreground">
                    {row.paidAt ? row.paidAt.toISOString().slice(0, 10) : "—"}
                  </TD>
                  <TD mono>{row.externalReference ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      )}
    </>
  )
}
