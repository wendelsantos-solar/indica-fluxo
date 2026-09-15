import { Receipt } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { EmptyState } from "@/components/feedback/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Pagination } from "@/components/ui/pagination"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { getFormatters } from "@/i18n/format"
import { Link } from "@/i18n/navigation"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listParticipationsForUser } from "@/server/repositories/affiliates"
import { listCommissionsForAffiliate } from "@/server/repositories/commissions"
import { EnvironmentBadge } from "@/features/programs/environment-badge"

import { pageNumber } from "../_components/page-number"
import { joinDetails, PortalList, PortalListItem } from "../_components/portal-list"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 25

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
export default async function AffiliateConversionsPage({
  searchParams,
}: PageProps<"/[locale]/affiliate/conversions">) {
  const t = await getTranslations("portal.conversions")
  const ta = await getTranslations("common.actions")
  const tp = await getTranslations("portal.shared")
  const tc = await getTranslations("common.table")
  const te = await getTranslations("common.environment")
  const f = await getFormatters()
  const user = await requireUser()
  const requestedPage = pageNumber((await searchParams).page)

  // Reversal rows (negative amounts) are the commission side of a refund, not
  // a payment of their own; the refunded payment keeps its `reversed` status.
  // `kind: "conversions"` leaves them out in SQL, so pages and the count agree.
  const { rows: conversions, total, page } = await withUser(user.id, async (tx) => {
    const participations = await listParticipationsForUser(tx, user.id)
    const ids = participations.map((participation) => participation.participationId)
    const pageOf = (target: number) =>
      listCommissionsForAffiliate(tx, ids, {
        kind: "conversions",
        limit: PAGE_SIZE,
        offset: (target - 1) * PAGE_SIZE,
      })

    let page = requestedPage
    let result = await pageOf(page)
    const last = Math.max(1, Math.ceil(result.total / PAGE_SIZE))
    if (page > last) {
      page = last
      result = await pageOf(page)
    }
    return { ...result, page }
  })

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <>
      <PageHeader
        title={t("title")}
        meta={total > 0 ? <span>{f.number(total)}</span> : undefined}
        description={t("description")}
      />

      {total === 0 ? (
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
                    <TD>
                      {row.programName}
                      {row.programEnvironment === "test" ? (
                        <EnvironmentBadge environment="test" className="ml-2" />
                      ) : null}
                    </TD>
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
                  row.programEnvironment === "test" ? `${row.programName} · ${te("test")}` : row.programName,
                  t("commissionOf", { amount: f.money(row.commissionAmountMinor, row.currency) }),
                ])}
              />
            ))}
          </PortalList>

          {pages > 1 ? (
            <Pagination
              label={tp("pagination")}
              summary={t("pageOf", { page, pages, count: total })}
              previous={page > 1 ? <Link href={pageHref(page - 1)} /> : null}
              next={page < pages ? <Link href={pageHref(page + 1)} /> : null}
              previousLabel={ta("previous")}
              nextLabel={ta("next")}
            />
          ) : null}
        </div>
      )}
    </>
  )
}

function pageHref(page: number) {
  return { pathname: "/affiliate/conversions", query: { page } } as const
}
