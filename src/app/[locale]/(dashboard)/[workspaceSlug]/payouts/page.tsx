import { CreditCard } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { Metric } from "@/components/data-display/metric"
import { getFormatters } from "@/i18n/format"
import { EmptyState } from "@/components/feedback/empty-state"
import { PageHeader, SectionHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { CancelBatchButton, MarkPaidDialog } from "@/features/payouts/batch-actions"
import { PayableList } from "@/features/payouts/payable-list"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import {
  listPayableByAffiliate,
  promoteEligibleCommissions,
} from "@/server/repositories/commissions"
import { listPayoutBatches } from "@/server/services/payouts"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/[workspaceSlug]/payouts">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.payouts" })
  return { title: t("title") }
}

export default async function PayoutsPage({ params }: PageProps<"/[locale]/[workspaceSlug]/payouts">) {
  const t = await getTranslations("dashboard.payouts")
  const tc = await getTranslations("common.table")
  const f = await getFormatters()
  const { workspaceSlug } = await params
  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)

  const { payable, batches } = await withUser(user.id, async (tx) => {
    await promoteEligibleCommissions(tx, workspace.id)
    return {
      payable: await listPayableByAffiliate(tx, workspace.id),
      batches: await listPayoutBatches(tx, workspace.id),
    }
  })

  const currency = payable[0]?.currency ?? workspace.defaultCurrency
  const availableTotal = payable
    .filter((row) => row.currency === currency)
    .reduce((sum, row) => sum + row.amountMinor, 0)

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
      />

      <div className="space-y-6">
        <Card>
          <CardContent>
            <Metric
              label={t("availableToPay")}
              value={f.money(availableTotal, currency)}
              comparison={t("clearedAffiliates", { count: payable.length })}
              size="lg"
            />
          </CardContent>
        </Card>

        <section>
          <SectionHeader title={t("readyToPay")} />
          {payable.length === 0 ? (
            <Card>
              <EmptyState
                icon={CreditCard}
                title={t("emptyPayable.title")}
                description={t("emptyPayable.description")}
              />
            </Card>
          ) : (
            <PayableList
              workspaceSlug={workspaceSlug}
              currency={currency}
              rows={payable.filter((row) => row.currency === currency)}
            />
          )}
        </section>

        <section>
          <SectionHeader title={t("history")} />
          {batches.length === 0 ? (
            <Card>
              <EmptyState
                icon={CreditCard}
                title={t("emptyHistory.title")}
                description={t("emptyHistory.description")}
              />
            </Card>
          ) : (
            <TableContainer scrollable>
              <Table>
                <THead>
                  <tr>
                    <TH>{t("batch")}</TH>
                    <TH>{tc("period")}</TH>
                    <TH numeric>{t("affiliates")}</TH>
                    <TH numeric>{t("total")}</TH>
                    <TH>{tc("status")}</TH>
                    <TH className="text-right">{tc("actions")}</TH>
                  </tr>
                </THead>
                <TBody>
                  {batches.map((batch) => (
                    <TR key={batch.id}>
                      <TD className="font-medium text-foreground">{batch.reference}</TD>
                      <TD className="text-muted-foreground">
                        {f.date(batch.periodStart)} → {f.date(batch.periodEnd)}
                      </TD>
                      <TD numeric>{f.number(batch.affiliateCount)}</TD>
                      <TD numeric className="font-medium text-foreground">
                        {f.money(batch.totalAmountMinor, batch.currency)}
                      </TD>
                      <TD>
                        <StatusBadge status={batch.status} />
                      </TD>
                      <TD>
                        <div className="flex items-center justify-end gap-1">
                          {batch.status === "approved" ? (
                            <>
                              <CancelBatchButton
                                workspaceSlug={workspaceSlug}
                                batchId={batch.id}
                              />
                              <MarkPaidDialog
                                workspaceSlug={workspaceSlug}
                                batchId={batch.id}
                                reference={batch.reference}
                                affiliateCount={batch.affiliateCount}
                                totalAmountMinor={batch.totalAmountMinor}
                                currency={batch.currency}
                              />
                            </>
                          ) : batch.paidAt ? (
                            <span className="text-meta text-muted-foreground">
                              {t("paidOn", { date: f.date(batch.paidAt) })}
                            </span>
                          ) : null}
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
          )}
        </section>
      </div>
    </>
  )
}
