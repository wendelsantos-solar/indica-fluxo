import { Coins } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { EmptyState } from "@/components/feedback/empty-state"
import { getFormatters } from "@/i18n/format"
import { PageHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listParticipationsForUser } from "@/server/repositories/affiliates"
import { listCommissionsForAffiliate } from "@/server/repositories/commissions"

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.commissions")
  return { title: t("title") }
}

export default async function AffiliateCommissionsPage() {
  const t = await getTranslations("portal.commissions")
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

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Coins}
            title={t("empty.title")}
            description={t("empty.description")}
          />
        </Card>
      ) : (
        <>
          {/* Desktop: the full financial table. */}
          <TableContainer scrollable className="hidden sm:block">
            <Table>
              <THead>
                <tr>
                  <TH>{tc("date")}</TH>
                  <TH>{tc("program")}</TH>
                  <TH>{tc("customer")}</TH>
                  <TH numeric>{t("sale")}</TH>
                  <TH numeric>{tc("rate")}</TH>
                  <TH numeric>{tc("commission")}</TH>
                  <TH>{tc("status")}</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id}>
                    <TD className="text-muted-foreground">
                      {f.date(row.createdAt)}
                    </TD>
                    <TD>{row.programName}</TD>
                    <TD mono>{row.customerRef}</TD>
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
                        {t("mobileSummary", {
                          date: f.date(row.createdAt),
                          amount: f.money(row.baseAmountMinor, row.currency),
                        })}
                      </span>
                      <span className="text-body-sm font-medium tabular-nums text-foreground">
                        {f.money(row.commissionAmountMinor, row.currency)}
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
