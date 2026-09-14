import { Receipt } from "lucide-react"
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
import { listCommissionsForAffiliate } from "@/server/repositories/commissions"

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.conversions")
  return { title: t("title") }
}

export default async function AffiliateConversionsPage() {
  const t = await getTranslations("portal.conversions")
  const tc = await getTranslations("common.table")
  const f = await getFormatters()
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
        title={t("title")}
        description={t("description")}
      />

      {conversions.length === 0 ? (
        <Card>
          <EmptyState
            icon={Receipt}
            title={t("empty.title")}
            description={t("empty.description")}
          />
        </Card>
      ) : (
        <TableContainer scrollable>
          <Table>
            <THead>
              <tr>
                <TH>{tc("date")}</TH>
                <TH>{tc("program")}</TH>
                <TH>{tc("customer")}</TH>
                <TH numeric>{t("sale")}</TH>
                <TH numeric>{t("yourCommission")}</TH>
                <TH>{tc("status")}</TH>
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
                  <TD numeric>{f.money(row.baseAmountMinor, row.currency)}</TD>
                  <TD numeric className="font-medium text-foreground">
                    {f.money(row.commissionAmountMinor, row.currency)}
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
