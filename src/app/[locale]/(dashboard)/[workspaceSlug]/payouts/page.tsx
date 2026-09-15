import { CreditCard } from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

import { Link } from "@/i18n/navigation"

import { Metric, MetricCell, MetricGrid } from "@/components/data-display/metric"
import { getFormatters } from "@/i18n/format"
import { EmptyState } from "@/components/feedback/empty-state"
import { InlineAlert } from "@/components/feedback/inline-alert"
import { PageHeader, SectionHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { TabLink } from "@/components/ui/tabs"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { CancelBatchButton, MarkPaidDialog } from "@/features/payouts/batch-actions"
import { formatBatchLabel } from "@/features/payouts/batch-label"
import { PayableList } from "@/features/payouts/payable-list"
import { formatDate } from "@/lib/money"
import { formatMoneyTotals, orderMoneyTotals, pickPrimaryCurrency, toMoneyTotals } from "@/lib/money-totals"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listPayableByAffiliate } from "@/server/repositories/commissions"
import { listPayoutBatches } from "@/server/repositories/payouts"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/[workspaceSlug]/payouts">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.payouts" })
  return { title: t("title") }
}

const BATCH_STATUSES = ["draft", "approved", "paid", "cancelled"] as const
type BatchStatus = (typeof BATCH_STATUSES)[number]

/** Lifts the row link's hit area over the whole row; the actions sit above it. */
const STRETCHED_LINK = [
  "rounded-badge after:absolute after:inset-0 after:content-['']",
  "focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring",
].join(" ")

export default async function PayoutsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/[workspaceSlug]/payouts">) {
  const t = await getTranslations("dashboard.payouts")
  const tc = await getTranslations("common.table")
  const locale = await getLocale()
  const { workspaceSlug } = await params
  const query = await searchParams
  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)
  const f = await getFormatters(workspace.timezone)

  // Read-only: `listPayableByAffiliate` already counts matured `pending`
  // commissions as payable, so rendering this page never writes to the ledger.
  // The promotion is written down when a batch is created.
  const [payable, batches] = await withUser(user.id, (tx) =>
    Promise.all([listPayableByAffiliate(tx, workspace.id), listPayoutBatches(tx, workspace.id)]),
  )

  // One figure per currency — never a sum across them. A batch holds a single
  // currency, so the list below shows one currency at a time.
  const totals = toMoneyTotals(payable)
  const primary = pickPrimaryCurrency(workspace.defaultCurrency, totals)
  const currencies = orderMoneyTotals(totals, primary).map((total) => total.currency)
  const requested = typeof query.currency === "string" ? query.currency.toUpperCase() : undefined
  const currency = requested && currencies.includes(requested) ? requested : (currencies[0] ?? primary)

  const payableRows = payable.filter((row) => row.currency === currency)
  const available = formatMoneyTotals(f.money, totals, currency)
  const clearedAffiliates = new Set(payable.map((row) => row.participationId)).size

  const awaitingPayment = batches.filter((batch) => batch.status === "approved").length
  // Creating, cancelling and paying a batch are owner/admin actions in the
  // service. Members keep the read-only totals and history (RLS lets every
  // member read the ledger) but never see the selection list they could not
  // submit, nor each affiliate's e-mail in it (UI_UX_FUNCTIONAL_FINDINGS O2).
  const canManage = workspace.role !== "member"

  // "approved" reads "Aprovada" for a commission; a batch in that state is
  // waiting for the founder to transfer the money, and is a masculine noun.
  const batchLabel = (status: string) =>
    BATCH_STATUSES.includes(status as BatchStatus) ? t(`batchStatus.${status as BatchStatus}`) : undefined

  const currencyHref = (code: string) =>
    ({
      pathname: "/[workspaceSlug]/payouts",
      params: { workspaceSlug },
      query: { currency: code },
    }) as const

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />

      <div className="space-y-10">
        <MetricGrid>
          <MetricCell>
            <Metric label={t("availableToPay")} value={available.primary}>
              {available.others ? (
                <p className="truncate text-meta tabular-nums text-muted-foreground">
                  {t("availableOtherCurrencies", { amounts: available.others })}
                </p>
              ) : null}
            </Metric>
          </MetricCell>
          <MetricCell>
            <Metric label={t("clearedAffiliatesLabel")} value={f.number(clearedAffiliates)} />
          </MetricCell>
          <MetricCell className="max-sm:col-span-2 max-sm:border-t max-sm:border-border-faint">
            <Metric label={t("awaitingPaymentLabel")} value={f.number(awaitingPayment)} />
          </MetricCell>
        </MetricGrid>

        <section>
          <SectionHeader
            title={t("readyToPay")}
            count={canManage && payableRows.length > 0 ? f.number(payableRows.length) : undefined}
            description={
              !canManage
                ? undefined
                : currencies.length > 1
                  ? t("readyToPayByCurrency")
                  : payableRows.length > 0
                    ? t("readyToPayDescription")
                    : undefined
            }
          />
          {!canManage ? (
            <InlineAlert>{t("memberReadOnly")}</InlineAlert>
          ) : currencies.length > 1 ? (
            <nav
              aria-label={t("currencyTabs")}
              className="-mx-4 mb-3 flex items-center gap-5 overflow-x-auto border-b border-border px-4 md:mx-0 md:px-0"
            >
              {orderMoneyTotals(totals, primary).map((total) => (
                <TabLink
                  key={total.currency}
                  href={currencyHref(total.currency)}
                  active={total.currency === currency}
                  className="shrink-0"
                >
                  <span className="font-mono text-meta">{total.currency}</span>
                  <span className="font-normal tabular-nums text-muted-foreground">
                    {f.money(total.amountMinor, total.currency)}
                  </span>
                </TabLink>
              ))}
            </nav>
          ) : null}
          {!canManage ? null : payableRows.length === 0 ? (
            <EmptyState
              icon={CreditCard}
              title={t("emptyPayable.title")}
              description={t("emptyPayable.description")}
              className="border-y border-border py-12"
            />
          ) : (
            // Keyed by currency: switching currency starts a fresh selection.
            <PayableList key={currency} workspaceSlug={workspaceSlug} currency={currency} rows={payableRows} />
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
                    {canManage && awaitingPayment > 0 ? <TH className="text-right">{tc("actions")}</TH> : null}
                  </tr>
                </THead>
                <TBody>
                  {batches.map((batch) => {
                    // UTC calendar dates, as the service writes them.
                    const period = `${formatDate(f.locale, batch.periodStart, "short", "UTC")} → ${formatDate(f.locale, batch.periodEnd, "short", "UTC")}`
                    const name = formatBatchLabel(locale, batch.periodEnd, batch.reference)
                    const total = f.money(batch.totalAmountMinor, batch.currency)
                    const label = batchLabel(batch.status)
                    const paidOn = batch.paidAt ? t("paidOn", { date: f.date(batch.paidAt) }) : null
                    // Rendered twice: in its own column on wide screens and
                    // under the stacked row on phones. Only one is visible.
                    // The irreversible "cancel" sits apart from "mark as paid".
                    // `relative z-raised` keeps them clickable above the row link.
                    const actions =
                      canManage && batch.status === "approved" ? (
                        <>
                          <CancelBatchButton
                            workspaceSlug={workspaceSlug}
                            batchId={batch.id}
                            batchLabel={name}
                          />
                          <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
                          <MarkPaidDialog
                            workspaceSlug={workspaceSlug}
                            batchId={batch.id}
                            batchLabel={name}
                            affiliateCount={batch.affiliateCount}
                            totalAmountMinor={batch.totalAmountMinor}
                            currency={batch.currency}
                          />
                        </>
                      ) : null
                    return (
                      <TR key={batch.id} interactive className="relative">
                        <TD className="max-md:py-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <Link
                              href={{
                                pathname: "/[workspaceSlug]/payouts/[batchId]",
                                params: { workspaceSlug, batchId: batch.id },
                              }}
                              className={`truncate text-foreground ${STRETCHED_LINK}`}
                            >
                              {name}
                            </Link>
                            <StatusBadge status={batch.status} label={label} className="md:hidden" />
                          </div>
                          <span className="mt-0.5 flex gap-3 text-meta text-muted-foreground md:hidden">
                            <span className="truncate">{paidOn ?? period}</span>
                            <span className="ml-auto shrink-0 tabular-nums text-foreground">{total}</span>
                          </span>
                          {actions ? (
                            <div className="relative z-raised mt-2 flex items-center justify-end gap-1 md:hidden">
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
                          <StatusBadge status={batch.status} label={label} />
                          {paidOn ? (
                            <span className="block whitespace-nowrap pt-0.5 text-meta text-muted-foreground">
                              {paidOn}
                            </span>
                          ) : null}
                        </TD>
                        {canManage && awaitingPayment > 0 ? (
                          <TD className="max-md:hidden">
                            <div className="relative z-raised flex items-center justify-end gap-1">{actions}</div>
                          </TD>
                        ) : null}
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
