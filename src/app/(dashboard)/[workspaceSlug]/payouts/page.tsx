import { CreditCard } from "lucide-react"
import type { Metadata } from "next"

import { Metric } from "@/components/data-display/metric"
import { EmptyState } from "@/components/feedback/empty-state"
import { PageHeader, SectionHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { CancelBatchButton, MarkPaidDialog } from "@/features/payouts/batch-actions"
import { PayableList } from "@/features/payouts/payable-list"
import { formatMoney, formatNumber } from "@/lib/money"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import {
  listPayableByAffiliate,
  promoteEligibleCommissions,
} from "@/server/repositories/commissions"
import { listPayoutBatches } from "@/server/services/payouts"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const metadata: Metadata = { title: "Payouts" }
export const dynamic = "force-dynamic"

export default async function PayoutsPage({ params }: PageProps<"/[workspaceSlug]/payouts">) {
  const { workspaceSlug } = await params
  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)

  const { payable, batches } = await withUser(user.id, async (tx) => {
    await promoteEligibleCommissions(tx, workspace.id)
    return {
      payable: await listPayableByAffiliate(tx, workspace.id),
      batches: await listPayoutBatches(tx, workspace.id),
    }
  })

  const currency = payable[0]?.currency ?? workspace.defaultCurrency
  const availableTotal = payable
    .filter((row) => row.currency === currency)
    .reduce((sum, row) => sum + row.amountMinor, 0)

  return (
    <>
      <PageHeader
        title="Payouts"
        description="Indica is the source of truth for what you owe. You pay affiliates through your own rails and record it here."
      />

      <div className="space-y-6">
        <Card>
          <CardContent>
            <Metric
              label="Available to pay"
              value={formatMoney(availableTotal, currency)}
              comparison={`${payable.length} affiliate${payable.length === 1 ? "" : "s"} with cleared commissions`}
              size="lg"
            />
          </CardContent>
        </Card>

        <section>
          <SectionHeader title="Ready to pay" />
          {payable.length === 0 ? (
            <Card>
              <EmptyState
                icon={CreditCard}
                title="Nothing to pay right now"
                description="Commissions become payable once they clear their program's hold period. Anything still pending is shown on the commissions page."
              />
            </Card>
          ) : (
            <PayableList
              workspaceSlug={workspaceSlug}
              currency={currency}
              rows={payable.filter((row) => row.currency === currency)}
            />
          )}
        </section>

        <section>
          <SectionHeader title="Payout history" />
          {batches.length === 0 ? (
            <Card>
              <EmptyState
                icon={CreditCard}
                title="No payout batches yet"
                description="A batch freezes the amounts owed at a point in time so your records match what you actually transferred."
              />
            </Card>
          ) : (
            <TableContainer scrollable>
              <Table>
                <THead>
                  <tr>
                    <TH>Batch</TH>
                    <TH>Period</TH>
                    <TH numeric>Affiliates</TH>
                    <TH numeric>Total</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Actions</TH>
                  </tr>
                </THead>
                <TBody>
                  {batches.map((batch) => (
                    <TR key={batch.id}>
                      <TD className="font-medium text-foreground">{batch.reference}</TD>
                      <TD className="text-muted-foreground">
                        {batch.periodStart.toISOString().slice(0, 10)} →{" "}
                        {batch.periodEnd.toISOString().slice(0, 10)}
                      </TD>
                      <TD numeric>{formatNumber(batch.affiliateCount)}</TD>
                      <TD numeric className="font-medium text-foreground">
                        {formatMoney(batch.totalAmountMinor, batch.currency)}
                      </TD>
                      <TD>
                        <StatusBadge status={batch.status} />
                      </TD>
                      <TD>
                        <div className="flex items-center justify-end gap-1">
                          {batch.status === "approved" ? (
                            <>
                              <CancelBatchButton
                                workspaceSlug={workspaceSlug}
                                batchId={batch.id}
                              />
                              <MarkPaidDialog
                                workspaceSlug={workspaceSlug}
                                batchId={batch.id}
                                reference={batch.reference}
                                affiliateCount={batch.affiliateCount}
                                totalAmountMinor={batch.totalAmountMinor}
                                currency={batch.currency}
                              />
                            </>
                          ) : batch.paidAt ? (
                            <span className="text-[12px] text-muted-foreground">
                              Paid {batch.paidAt.toISOString().slice(0, 10)}
                            </span>
                          ) : null}
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
          )}
        </section>
      </div>
    </>
  )
}
