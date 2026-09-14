import { CreditCard } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { Metric, MetricCell, MetricGrid } from "@/components/data-display/metric"
import { getFormatters } from "@/i18n/format"
import { EmptyState } from "@/components/feedback/empty-state"
import { PageHeader, SectionHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
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

  const pendingBatches = batches.filter((batch) => batch.status === "approved").length

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />

      <div className="space-y-10">
        <MetricGrid>
          <MetricCell>
            <Metric
              label={t("availableToPay")}
              value={f.money(availableTotal, currency)}
              comparison={t("clearedAffiliates", { count: payable.length })}
            />
          </MetricCell>
        </MetricGrid>

        <section>
          <SectionHeader
            title={t("readyToPay")}
            count={payable.length > 0 ? f.number(payable.length) : undefined}
          />
          {payable.length === 0 ? (
            <EmptyState
              icon={CreditCard}
              title={t("emptyPayable.title")}
              description={t("emptyPayable.description")}
              className="border-y border-border py-12"
            />
          ) : (
            <PayableList
              workspaceSlug={workspaceSlug}
              currency={currency}
              rows={payable.filter((row) => row.currency === currency)}
            />
          )}
        </section>

        <section>
          <SectionHeader
            title={t("history")}
            count={batches.length > 0 ? f.number(batches.length) : undefined}
          />
          {batches.length === 0 ? (
            <EmptyState
              icon={CreditCard}
              title={t("emptyHistory.title")}
              description={t("emptyHistory.description")}
              className="border-y border-border py-12"
            />
          ) : (
            <TableContainer>
              <Table>
                <THead className="max-md:hidden">
                  <tr>
                    <TH>{t("batch")}</TH>
                    <TH>{tc("period")}</TH>
                    <TH numeric>{t("affiliates")}</TH>
                    <TH numeric>{t("total")}</TH>
                    <TH>{tc("status")}</TH>
                    <TH className="text-right">
                      <span className={pendingBatches === 0 ? "sr-only" : undefined}>
                        {tc("actions")}
                      </span>
                    </TH>
                  </tr>
                </THead>
                <TBody>
                  {batches.map((batch) => {
                    const period = `${f.date(batch.periodStart)} → ${f.date(batch.periodEnd)}`
                    const total = f.money(batch.totalAmountMinor, batch.currency)
                    // Rendered twice: in its own column on wide screens and
                    // under the stacked row on phones. Only one is visible.
                    const actions =
                      batch.status === "approved" ? (
                        <>
                          <CancelBatchButton workspaceSlug={workspaceSlug} batchId={batch.id} />
                          <MarkPaidDialog
                            workspaceSlug={workspaceSlug}
                            batchId={batch.id}
                            reference={batch.reference}
                            affiliateCount={batch.affiliateCount}
                            totalAmountMinor={batch.totalAmountMinor}
                            currency={batch.currency}
                          />
                        </>
                      ) : null
                    return (
                      <TR key={batch.id}>
                        <TD className="max-md:py-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate font-mono text-meta text-foreground">
                              {batch.reference}
                            </span>
                            <StatusBadge status={batch.status} className="md:hidden" />
                          </div>
                          <span className="mt-0.5 flex gap-3 text-meta text-muted-foreground md:hidden">
                            <span className="truncate">{period}</span>
                            <span className="ml-auto shrink-0 tabular-nums text-foreground-secondary">
                              {total}
                            </span>
                          </span>
                          {actions ? (
                            <div className="mt-2 flex items-center justify-end gap-1 md:hidden">
                              {actions}
                            </div>
                          ) : null}
                        </TD>
                        <TD className="whitespace-nowrap text-muted-foreground max-md:hidden">
                          {period}
                        </TD>
                        <TD numeric className="max-md:hidden">
                          {f.number(batch.affiliateCount)}
                        </TD>
                        <TD numeric className="text-foreground max-md:hidden">
                          {total}
                        </TD>
                        <TD className="max-md:hidden">
                          <StatusBadge status={batch.status} />
                        </TD>
                        <TD className="max-md:hidden">
                          <div className="flex items-center justify-end gap-1">
                            {batch.status === "approved" ? (
                              actions
                            ) : batch.paidAt ? (
                              <span className="whitespace-nowrap text-meta text-muted-foreground">
                                {t("paidOn", { date: f.date(batch.paidAt) })}
                              </span>
                            ) : null}
                          </div>
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            </TableContainer>
          )}
        </section>
      </div>
    </>
  )
}
