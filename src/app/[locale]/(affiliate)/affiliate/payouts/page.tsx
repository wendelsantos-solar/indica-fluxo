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

import { PortalList, PortalListItem } from "../_components/portal-list"

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.payouts")
  return { title: t("title") }
}

/**
 * The record of what the program owner says they paid. IndicaFluxo moves no
 * money, so the page never implies it did: a payout is "paid" on the date the
 * owner marked it, and the reference is theirs.
 */
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

  function paidLine(row: (typeof rows)[number]) {
    if (row.paidAt) return t("paidOn", { date: f.date(row.paidAt) })
    return row.status === "pending" ? t("awaiting") : null
  }

  return (
    <>
      <PageHeader
        title={t("title")}
        meta={rows.length > 0 ? <span>{f.number(rows.length)}</span> : undefined}
        description={t("description")}
      />

      {rows.length === 0 ? (
        <EmptyState icon={CreditCard} title={t("empty.title")} description={t("empty.description")} />
      ) : (
        <>
          <TableContainer scrollable className="hidden md:block">
            <Table>
              <THead>
                <tr>
                  <TH>{t("batch")}</TH>
                  <TH numeric>{tc("amount")}</TH>
                  <TH>{tc("status")}</TH>
                  <TH>{t("paid")}</TH>
                  <TH>{t("paymentReference")}</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id}>
                    <TD mono className="text-foreground">
                      {row.reference}
                    </TD>
                    <TD numeric className="font-medium text-foreground">
                      {f.money(row.amountMinor, row.currency)}
                    </TD>
                    <TD>
                      <StatusBadge status={row.status} />
                    </TD>
                    <TD className="whitespace-nowrap text-muted-foreground">
                      {row.paidAt ? f.date(row.paidAt) : row.status === "pending" ? t("awaiting") : "—"}
                    </TD>
                    <TD mono>{row.externalReference ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>

          <PortalList className="md:hidden">
            {rows.map((row) => (
              <PortalListItem
                key={row.id}
                title={<span className="font-mono text-caption">{row.reference}</span>}
                status={<StatusBadge status={row.status} />}
                amount={f.money(row.amountMinor, row.currency)}
                details={
                  paidLine(row) || row.externalReference ? (
                    <>
                      {paidLine(row) ? <span className="block">{paidLine(row)}</span> : null}
                      {row.externalReference ? (
                        <span className="block truncate">
                          {t.rich("paymentReferenceValue", {
                            reference: row.externalReference,
                            mono: (chunks) => (
                              <span className="font-mono text-faint-foreground">{chunks}</span>
                            ),
                          })}
                        </span>
                      ) : null}
                    </>
                  ) : undefined
                }
              />
            ))}
          </PortalList>
        </>
      )}
    </>
  )
}
