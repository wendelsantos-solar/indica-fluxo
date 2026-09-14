import { CreditCard } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { EmptyState } from "@/components/feedback/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { getFormatters } from "@/i18n/format"
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
        meta={rows.length > 0 ? <span>{f.number(rows.length)}</span> : undefined}
        description={t("description")}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <div>
          <TableContainer scrollable className="hidden md:block">
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
                    <TD className="whitespace-nowrap text-muted-foreground">
                      {row.paidAt ? f.date(row.paidAt) : "—"}
                    </TD>
                    <TD mono>{row.externalReference ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>

          <ul className="divide-y divide-border-faint border-y border-border md:hidden">
            {rows.map((row) => (
              <li key={row.id} className="flex items-start justify-between gap-4 px-1 py-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate text-ui text-foreground">{row.reference}</p>
                  {row.paidAt ? (
                    <p className="text-meta text-muted-foreground">
                      {t("paid")} {f.date(row.paidAt)}
                    </p>
                  ) : null}
                  {row.externalReference ? (
                    <p className="truncate font-mono text-label text-faint-foreground">
                      {row.externalReference}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span className="text-ui font-medium tabular-nums text-foreground">
                    {f.money(row.amountMinor, row.currency)}
                  </span>
                  <StatusBadge status={row.status} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
