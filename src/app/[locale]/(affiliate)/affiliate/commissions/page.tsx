import { ChevronDown, Coins } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { EmptyState } from "@/components/feedback/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { Term } from "@/components/ui/term"
import { getFormatters } from "@/i18n/format"
import { Link } from "@/i18n/navigation"
import { cn } from "@/lib/utils"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { effectiveCommissionStatus } from "@/server/domain/commission"
import { listParticipationsForUser } from "@/server/repositories/affiliates"
import { listCommissionsForAffiliate } from "@/server/repositories/commissions"

import { joinDetails, PortalList, PortalListItem } from "../_components/portal-list"

export const dynamic = "force-dynamic"

/** `listCommissionsForAffiliate` returns at most this many rows, newest first. */
const LIST_LIMIT = 100

const STATUS_ORDER = ["pending", "available", "approved", "paid", "reversed", "rejected"] as const

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.commissions")
  return { title: t("title") }
}

/**
 * What the affiliate earned from each payment, and where each amount is on its
 * way to being paid. A status is shown as the ledger rule reads it: a pending
 * commission whose hold period has ended is already available, even if no
 * founder page has promoted the stored row yet.
 */
export default async function AffiliateCommissionsPage() {
  const t = await getTranslations("portal.commissions")
  const tp = await getTranslations("portal.shared")
  const ts = await getTranslations("status")
  const tc = await getTranslations("common.table")
  const f = await getFormatters()
  const user = await requireUser()

  const { rows, now } = await withUser(user.id, async (tx) => {
    const participations = await listParticipationsForUser(tx, user.id)
    const rows = await listCommissionsForAffiliate(
      tx,
      participations.map((participation) => participation.participationId),
      LIST_LIMIT,
    )
    return { rows, now: new Date() }
  })

  const capped = rows.length >= LIST_LIMIT

  const statusDefinition = STATUS_ORDER.map(
    (status) => `${ts(status)}: ${t(`statusHelp.${status}`)}`,
  ).join(" ")

  const view = rows.map((row) => {
    const status = effectiveCommissionStatus(row.status, row.eligibleAt, now)
    const reversal = row.commissionAmountMinor < 0
    return {
      ...row,
      status,
      reversal,
      amount: f.money(row.commissionAmountMinor, row.currency, {
        signDisplay: reversal ? "always" : "auto",
      }),
      rate: row.commissionRate ? f.basisPoints(row.commissionRate) : t("fixed"),
      releases: status === "pending" ? t("releasesOn", { date: f.date(row.eligibleAt) }) : null,
    }
  })

  return (
    <>
      <PageHeader
        title={t("title")}
        meta={
          rows.length > 0 ? (
            <span>{capped ? tp("latest", { count: rows.length }) : f.number(rows.length)}</span>
          ) : undefined
        }
        description={t("description")}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Coins}
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
                  <TH numeric>{tc("rate")}</TH>
                  <TH numeric>{tc("commission")}</TH>
                  <TH>
                    <Term definition={statusDefinition}>{tc("status")}</Term>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {view.map((row) => (
                  <TR key={row.id}>
                    <TD className="whitespace-nowrap text-muted-foreground">
                      {f.date(row.createdAt)}
                    </TD>
                    <TD>{row.programName}</TD>
                    <TD mono>{row.customerRef}</TD>
                    <TD numeric>{f.money(row.baseAmountMinor, row.currency)}</TD>
                    <TD numeric>{row.rate}</TD>
                    <TD
                      numeric
                      className={cn(
                        "font-medium",
                        row.reversal ? "text-danger-foreground" : "text-foreground",
                      )}
                    >
                      {row.amount}
                      {row.reversal ? <span className="sr-only"> ({t("reversal")})</span> : null}
                    </TD>
                    <TD>
                      <div className="flex flex-col items-start gap-0.5">
                        <StatusBadge status={row.status} />
                        {row.releases ? (
                          <span className="whitespace-nowrap text-meta text-muted-foreground">
                            {row.releases}
                          </span>
                        ) : null}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>

          <PortalList className="md:hidden">
            {view.map((row) => (
              <PortalListItem
                key={row.id}
                title={row.programName}
                status={<StatusBadge status={row.status} />}
                amount={row.amount}
                amountClassName={row.reversal ? "text-danger-foreground" : undefined}
                details={
                  <>
                    <span className="block">
                      {joinDetails([
                        row.reversal ? t("reversal") : null,
                        f.date(row.createdAt),
                        t("saleOf", { amount: f.money(row.baseAmountMinor, row.currency) }),
                        row.rate,
                      ])}
                    </span>
                    {row.releases ? <span className="block">{row.releases}</span> : null}
                    <span className="block truncate font-mono text-faint-foreground">
                      {row.customerRef}
                    </span>
                  </>
                }
              />
            ))}
          </PortalList>

          <details className="group max-w-[68ch] text-caption">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-control text-muted-foreground transition-colors duration-[120ms] hover:text-foreground md:min-h-8 [&::-webkit-details-marker]:hidden">
              {t("legendTitle")}
              <ChevronDown
                aria-hidden="true"
                className="size-3.5 transition-transform duration-[120ms] group-open:rotate-180"
              />
            </summary>
            <dl className="mt-1 divide-y divide-border-faint border-y border-border">
              {STATUS_ORDER.map((status) => (
                <div key={status} className="flex flex-col gap-1 px-1 py-2.5 sm:flex-row sm:gap-4">
                  <dt className="shrink-0 sm:w-28">
                    <StatusBadge status={status} />
                  </dt>
                  <dd className="text-pretty text-muted-foreground">{t(`statusHelp.${status}`)}</dd>
                </div>
              ))}
            </dl>
          </details>

          {capped ? (
            <p className="text-meta text-faint-foreground">{tp("cappedNote")}</p>
          ) : null}
        </div>
      )}
    </>
  )
}
