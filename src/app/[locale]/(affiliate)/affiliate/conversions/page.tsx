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

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.conversions")
  return { title: t("title") }
}

export default async function AffiliateConversionsPage() {
  const t = await getTranslations("portal.conversions")
  const tcm = await getTranslations("portal.commissions")
  const to = await getTranslations("portal.overview")
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
        meta={conversions.length > 0 ? <span>{f.number(conversions.length)}</span> : undefined}
        description={t("description")}
      />

      {conversions.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={t("empty.title")}
          description={t("empty.description")}
          action={
            <Button asChild variant="secondary">
              <Link href="/affiliate/links">{to("yourLinks")}</Link>
            </Button>
          }
        />
      ) : (
        <div>
          <TableContainer scrollable className="hidden md:block">
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
                    <TD className="whitespace-nowrap text-muted-foreground">
                      {f.date(row.createdAt)}
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

          <ul className="divide-y divide-border-faint border-y border-border md:hidden">
            {conversions.map((row) => (
              <li key={row.id} className="flex items-start justify-between gap-4 px-1 py-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate font-mono text-meta text-foreground">{row.customerRef}</p>
                  <p className="truncate text-meta text-muted-foreground">
                    {row.programName}
                  </p>
                  <p className="text-meta text-muted-foreground">
                    {tcm("mobileSummary", {
                      date: f.date(row.createdAt),
                      amount: f.money(row.baseAmountMinor, row.currency),
                    })}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span className="text-ui font-medium tabular-nums text-foreground">
                    {f.money(row.commissionAmountMinor, row.currency)}
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
