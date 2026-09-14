import { Receipt } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

import { EmptyState } from "@/components/feedback/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { formatMoney } from "@/lib/money"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { getRecentConversions } from "@/server/repositories/analytics"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const metadata: Metadata = { title: "Conversions" }
export const dynamic = "force-dynamic"

export default async function ConversionsPage({
  params,
}: PageProps<"/[workspaceSlug]/conversions">) {
  const { workspaceSlug } = await params
  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)

  const conversions = await withUser(user.id, (tx) =>
    getRecentConversions(tx, workspace.id, 100),
  )

  return (
    <>
      <PageHeader
        title="Conversions"
        description="Payments from customers your affiliates brought in."
      />

      {conversions.length === 0 ? (
        <Card>
          <EmptyState
            icon={Receipt}
            title="No conversions yet"
            description="Once a tracked visitor becomes a paying customer, the payment shows up here with the affiliate that earned it."
            action={
              <Button asChild variant="primary">
                <Link href={`/${workspaceSlug}/integrations`}>Connect billing</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <TableContainer scrollable>
          <Table>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Affiliate</TH>
                <TH>Customer</TH>
                <TH numeric>Payment</TH>
                <TH numeric>Commission</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <TBody>
              {conversions.map((conversion) => (
                <TR key={conversion.id} interactive>
                  <TD className="text-muted-foreground">
                    {conversion.occurredAt.toISOString().slice(0, 10)}
                  </TD>
                  <TD className="text-foreground">{conversion.affiliateName}</TD>
                  <TD mono>{conversion.customerRef}</TD>
                  <TD numeric>{formatMoney(conversion.amountMinor, conversion.currency)}</TD>
                  <TD numeric className="text-foreground">
                    {formatMoney(conversion.commissionMinor, conversion.currency)}
                  </TD>
                  <TD>
                    <StatusBadge status={conversion.status} />
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
