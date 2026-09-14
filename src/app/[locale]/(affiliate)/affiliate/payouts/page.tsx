import { CreditCard } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

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

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.payouts")
  return { title: t("title") }
}

export default async function AffiliatePayoutsPage() {
  const t = await getTranslations("portal.payouts")
  const tc = await getTranslations("common.table")
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
        title={t("title")}
        description={t("description")}
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={CreditCard}
            title={t("empty.title")}
            description={t("empty.description")}
          />
        </Card>
      ) : (
        <TableContainer scrollable>
          <Table>
            <THead>
              <tr>
                <TH>{t("batch")}</TH>
                <TH numeric>{tc("amount")}</TH>
                <TH>{tc("status")}</TH>
                <TH>{t("paid")}</TH>
                <TH>{tc("reference")}</TH>
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
                    {row.paidAt ? f.date(row.paidAt) : "—"}
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
