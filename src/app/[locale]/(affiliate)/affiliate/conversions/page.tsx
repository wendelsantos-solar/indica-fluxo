import { Receipt } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { EmptyState } from "@/components/feedback/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { getFormatters } from "@/i18n/format"
import { Link } from "@/i18n/navigation"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listParticipationsForUser } from "@/server/repositories/affiliates"
import { listCommissionsForAffiliate } from "@/server/repositories/commissions"

import { joinDetails, PortalList, PortalListItem } from "../_components/portal-list"

export const dynamic = "force-dynamic"

/** `listCommissionsForAffiliate` returns at most this many rows, newest first. */
const LIST_LIMIT = 100

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.conversions")
  return { title: t("title") }
}

/**
 * The payments made by customers this affiliate referred — the customer's
 * side. Commissions is the affiliate's side of the same events, so this page
 * leads with the payment amount and only marks a payment that was refunded;
 * the commission's own lifecycle lives on the Commissions page.
 */
export default async function AffiliateConversionsPage() {
  const t = await getTranslations("portal.conversions")
  const tp = await getTranslations("portal.shared")
  const tc = await getTranslations("common.table")
  const f = await getFormatters()
  const user = await requireUser()

  const rows = await withUser(user.id, async (tx) => {
    const participations = await listParticipationsForUser(tx, user.id)
    return listCommissionsForAffiliate(
      tx,
      participations.map((participation) => participation.participationId),
      LIST_LIMIT,
    )
  })

  // Reversal rows (negative amounts) are the commission side of a refund, not
  // a payment of their own; the refunded payment keeps its `reversed` status.
  const conversions = rows.filter((row) => row.commissionAmountMinor > 0)
  const capped = rows.length >= LIST_LIMIT

  return (
    <>
      <PageHeader
        title={t("title")}
        meta={
          conversions.length > 0 ? (
            <span>
              {capped ? tp("latest", { count: conversions.length }) : f.number(conversions.length)}
            </span>
          ) : undefined
        }
        description={t("description")}
      />

      {conversions.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={t("empty.title")}
          description={t("empty.description")}
          action={
            <Button asChild variant="secondary" className="max-sm:h-11">
              <Link href="/affiliate/links">{tp("viewLinks")}</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <TableContainer scrollable className="hidden md:block">
            <Table>
              <THead>
                <tr>
                  <TH>{tc("date")}</TH>
                  <TH>{tc("program")}</TH>
                  <TH>{tc("customer")}</TH>
                  <TH numeric>{t("sale")}</TH>
                  <TH numeric>{t("yourCommission")}</TH>
                  <TH>
                    <span className="sr-only">{tc("status")}</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {conversions.map((row) => (
                  <TR key={row.id}>
                    <TD className="whitespace-nowrap text-muted-foreground">
                      {f.date(row.createdAt)}
                    </TD>
                    <TD>{row.programName}</TD>
                    <TD mono>{row.customerRef}</TD>
                    <TD numeric className="font-medium text-foreground">
                      {f.money(row.baseAmountMinor, row.currency)}
                    </TD>
                    <TD numeric>{f.money(row.commissionAmountMinor, row.currency)}</TD>
                    <TD>{row.status === "reversed" ? <StatusBadge status="reversed" /> : null}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>

          <PortalList className="md:hidden">
            {conversions.map((row) => (
              <PortalListItem
                key={row.id}
                title={<span className="font-mono text-caption">{row.customerRef}</span>}
                status={row.status === "reversed" ? <StatusBadge status="reversed" /> : undefined}
                amount={f.money(row.baseAmountMinor, row.currency)}
                details={joinDetails([
                  f.date(row.createdAt),
                  row.programName,
                  t("commissionOf", { amount: f.money(row.commissionAmountMinor, row.currency) }),
                ])}
              />
            ))}
          </PortalList>

          {capped ? (
            <p className="text-meta text-faint-foreground">{tp("cappedNote")}</p>
          ) : null}
        </div>
      )}
    </>
  )
}
