import { Users } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { notFound } from "next/navigation"
import type * as React from "react"

import { Link } from "@/i18n/navigation"

import { Metric, MetricCell, MetricGrid } from "@/components/data-display/metric"
import { EmptyState } from "@/components/feedback/empty-state"
import { PageHeader, SectionHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { CancelBatchButton, MarkPaidDialog } from "@/features/payouts/batch-actions"
import { getFormatters } from "@/i18n/format"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { findPayoutBatch, listBatchItems } from "@/server/repositories/payouts"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/[workspaceSlug]/payouts/[batchId]">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.batch" })
  return { title: t("metaTitle") }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BATCH_STATUSES = ["draft", "approved", "paid", "cancelled"] as const
const ITEM_STATUSES = ["pending", "paid", "failed", "cancelled"] as const
const ITEM_LIMIT = 500

export default async function PayoutBatchPage({
  params,
}: PageProps<"/[locale]/[workspaceSlug]/payouts/[batchId]">) {
  const { workspaceSlug, batchId } = await params
  // Not a uuid is not a batch; Postgres would reject the cast with a 500.
  if (!UUID.test(batchId)) notFound()

  const t = await getTranslations("dashboard.batch")
  const tp = await getTranslations("dashboard.payouts")
  const tc = await getTranslations("common.table")
  const f = await getFormatters()

  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)

  // RLS returns nothing for another workspace's batch, and the query scopes to
  // this workspace as well, so an unknown and a foreign id look the same.
  const data = await withUser(user.id, async (tx) => {
    const batch = await findPayoutBatch(tx, workspace.id, batchId)
    if (!batch) return null
    return { batch, items: await listBatchItems(tx, batch.id, ITEM_LIMIT) }
  })
  if (!data) notFound()
  const { batch, items } = data

  const status = BATCH_STATUSES.find((value) => value === batch.status)
  const statusLabel = status ? tp(`batchStatus.${status}`) : undefined
  const itemLabel = (value: string) => {
    const known = ITEM_STATUSES.find((candidate) => candidate === value)
    return known ? t(`itemStatus.${known}`) : undefined
  }

  const canManage = workspace.role !== "member"
  const awaitingPayment = batch.status === "approved"

  return (
    <>
      <PageHeader
        breadcrumb={[
          <Link key="payouts" href={{ pathname: "/[workspaceSlug]/payouts", params: { workspaceSlug } }}>
            {tp("title")}
          </Link>,
        ]}
        title={batch.reference}
        meta={<StatusBadge status={batch.status} label={statusLabel} />}
        description={t("description")}
        actions={
          canManage && awaitingPayment ? (
            <>
              <CancelBatchButton workspaceSlug={workspaceSlug} batchId={batch.id} reference={batch.reference} />
              <MarkPaidDialog
                workspaceSlug={workspaceSlug}
                batchId={batch.id}
                reference={batch.reference}
                affiliateCount={batch.affiliateCount}
                totalAmountMinor={batch.totalAmountMinor}
                currency={batch.currency}
                triggerVariant="primary"
              />
            </>
          ) : null
        }
      />

      <div className="max-w-detail space-y-10">
        <div className="space-y-6">
          <MetricGrid>
            <MetricCell>
              <Metric label={t("total")} value={f.money(batch.totalAmountMinor, batch.currency)} />
            </MetricCell>
            <MetricCell>
              <Metric label={t("affiliates")} value={f.number(batch.affiliateCount)} />
            </MetricCell>
            <MetricCell className="max-sm:col-span-2 max-sm:border-t max-sm:border-border-faint">
              <Metric label={t("commissions")} value={f.number(batch.commissionCount)} />
            </MetricCell>
          </MetricGrid>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <Detail term={t("period")}>
              {f.date(batch.periodStart)} → {f.date(batch.periodEnd)}
            </Detail>
            <Detail term={t("createdOn")}>{f.date(batch.createdAt)}</Detail>
            <Detail term={t("paidOn")}>{batch.paidAt ? f.date(batch.paidAt) : t("notPaid")}</Detail>
            <Detail term={t("currency")}>
              <span className="font-mono text-meta">{batch.currency}</span>
            </Detail>
            {batch.notes ? (
              <Detail term={t("notes")} className="col-span-full">
                {batch.notes}
              </Detail>
            ) : null}
          </dl>
        </div>

        <section>
          <SectionHeader
            title={t("items")}
            count={items.length > 0 ? f.number(batch.affiliateCount) : undefined}
            description={
              items.length < batch.affiliateCount
                ? t("itemsCapped", { shown: f.number(items.length), total: f.number(batch.affiliateCount) })
                : undefined
            }
          />
          {items.length === 0 ? (
            <EmptyState
              icon={Users}
              title={t("emptyItems.title")}
              description={t("emptyItems.description")}
              className="border-y border-border py-12"
            />
          ) : (
            <TableContainer>
              <Table>
                <THead className="max-md:hidden">
                  <tr>
                    <TH>{tc("affiliate")}</TH>
                    <TH numeric>{t("commissions")}</TH>
                    <TH numeric>{tc("amount")}</TH>
                    <TH>{tc("status")}</TH>
                  </tr>
                </THead>
                <TBody>
                  {items.map((item) => {
                    const amount = f.money(item.amountMinor, item.currency)
                    const label = itemLabel(item.status)
                    return (
                      <TR key={item.id}>
                        <TD className="max-w-0 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate text-foreground">{item.affiliateName}</span>
                            <StatusBadge status={item.status} label={label} className="md:hidden" />
                          </div>
                          <span className="block truncate text-meta text-muted-foreground">
                            <span className="font-mono">{item.code}</span>
                            {" · "}
                            {item.affiliateEmail}
                          </span>
                          <span className="mt-0.5 flex gap-3 text-meta text-muted-foreground md:hidden">
                            <span className="truncate">
                              {t("commissionCount", { count: item.commissionCount })}
                            </span>
                            <span className="ml-auto shrink-0 tabular-nums text-foreground">{amount}</span>
                          </span>
                        </TD>
                        <TD numeric className="max-md:hidden">
                          {f.number(item.commissionCount)}
                        </TD>
                        <TD numeric className="text-foreground max-md:hidden">
                          {amount}
                        </TD>
                        <TD className="max-md:hidden">
                          <StatusBadge status={item.status} label={label} />
                          {item.externalReference ? (
                            <span className="block truncate pt-0.5 font-mono text-meta text-muted-foreground">
                              {item.externalReference}
                            </span>
                          ) : null}
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

function Detail({
  term,
  className,
  children,
}: {
  term: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className}>
      <dt className="text-meta text-muted-foreground">{term}</dt>
      <dd className="mt-0.5 text-caption tabular-nums text-foreground-secondary">{children}</dd>
    </div>
  )
}
