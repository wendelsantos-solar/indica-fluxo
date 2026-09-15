"use client"

import { useTranslations } from "next-intl"
import { useActionState, useState } from "react"

import { InlineAlert } from "@/components/feedback/inline-alert"
import { Button } from "@/components/ui/button"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { useActionResult } from "@/components/ui/use-action-result"
import { useFormatters } from "@/i18n/use-formatters"

import { createPayoutBatchAction, type PayoutFormState } from "./actions"

const INITIAL: PayoutFormState = {}

export interface PayableRow {
  participationId: string
  affiliateName: string
  affiliateEmail: string
  code: string
  currency: string
  amountMinor: number
  commissionCount: number
}

/**
 * Neutral, not amber: the amber on this view belongs to "Create payout batch".
 * `accent-foreground` follows the theme (light ink in dark, dark ink in light).
 */
const CHECKBOX = "size-4 accent-foreground"

/**
 * Selection drives a single server action; the total updates locally so the
 * founder sees exactly what the batch will contain before committing.
 *
 * Nothing is selected up front: a batch is a money decision, so every
 * affiliate in it is an explicit choice ("Select all" is one click away).
 */
export function PayableList({
  workspaceSlug,
  rows,
  currency,
}: {
  workspaceSlug: string
  rows: PayableRow[]
  currency: string
}) {
  const t = useTranslations("forms.payable")
  const tc = useTranslations("common.table")
  const f = useFormatters()
  const [picked, setPicked] = useState<string[]>([])
  const [state, action, pending] = useActionState(createPayoutBatchAction, INITIAL)

  // A created batch removes its affiliates from this list; start over empty.
  // Errors are shown inline next to the button, never as a toast as well.
  useActionResult(state, { onSuccess: () => setPicked([]), toastOnError: false })

  // Ids that are no longer payable (paid in another tab, batched) never count.
  const selected = picked.filter((id) => rows.some((row) => row.participationId === id))
  const total = rows
    .filter((row) => selected.includes(row.participationId))
    .reduce((sum, row) => sum + row.amountMinor, 0)

  const allSelected = rows.length > 0 && selected.length === rows.length
  const someSelected = selected.length > 0 && !allSelected
  const selectAll = (checked: boolean) => setPicked(checked ? rows.map((row) => row.participationId) : [])

  return (
    <form action={action}>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="currency" value={currency} />
      {selected.map((id) => (
        <input key={id} type="hidden" name="participationIds" value={id} />
      ))}

      <TableContainer>
        <Table>
          <THead>
            <tr>
              <TH className="w-10">
                <label className="-ml-2 flex size-8 items-center justify-center">
                  <input
                    type="checkbox"
                    aria-label={t("selectAll")}
                    checked={allSelected}
                    ref={(element) => {
                      if (element) element.indeterminate = someSelected
                    }}
                    onChange={(event) => selectAll(event.target.checked)}
                    className={CHECKBOX}
                  />
                </label>
              </TH>
              <TH>{tc("affiliate")}</TH>
              <TH numeric className="max-md:hidden">
                {t("commissions")}
              </TH>
              <TH numeric>{tc("amount")}</TH>
            </tr>
          </THead>
          <TBody>
            {rows.map((row) => {
              const checked = selected.includes(row.participationId)
              const inputId = `payable-${row.participationId}`
              return (
                <TR key={row.participationId} className={checked ? "bg-selected" : undefined}>
                  <TD>
                    <label htmlFor={inputId} className="-ml-2 flex size-8 items-center justify-center">
                      <input
                        id={inputId}
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          setPicked((previous) =>
                            event.target.checked
                              ? [...previous, row.participationId]
                              : previous.filter((id) => id !== row.participationId),
                          )
                        }
                        className={CHECKBOX}
                      />
                    </label>
                  </TD>
                  <TD className="max-w-0 py-2">
                    {/* The whole cell toggles the checkbox, so the hit area is the row. */}
                    <label htmlFor={inputId} className="block min-w-0">
                      <span className="block truncate text-foreground">{row.affiliateName}</span>
                      <span className="block truncate text-meta text-muted-foreground">
                        <span className="font-mono">{row.code}</span>
                        {" · "}
                        {row.affiliateEmail}
                        <span className="md:hidden">
                          {" · "}
                          {t("commissionCount", { count: row.commissionCount })}
                        </span>
                      </span>
                    </label>
                  </TD>
                  <TD numeric className="max-md:hidden">
                    {f.number(row.commissionCount)}
                  </TD>
                  <TD numeric className="text-foreground">
                    {f.money(row.amountMinor, row.currency)}
                  </TD>
                </TR>
              )
            })}
          </TBody>
        </Table>
      </TableContainer>

      <div className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-caption tabular-nums text-muted-foreground" aria-live="polite">
            {t("selection", { selected: selected.length, total: rows.length })}
            {" · "}
            <span className="text-foreground">{f.money(total, currency)}</span>
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={() => selectAll(!allSelected)}>
            {allSelected ? t("clearSelection") : t("selectAllShort")}
          </Button>
        </div>
        <Button type="submit" variant="primary" loading={pending} disabled={selected.length === 0}>
          {t("submit")}
        </Button>
      </div>

      {state.error ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
    </form>
  )
}
