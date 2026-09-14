"use client"

import { useTranslations } from "next-intl"
import { useActionState, useState } from "react"

import { Button } from "@/components/ui/button"
import { useFormatters } from "@/i18n/use-formatters"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { useActionResult } from "@/components/ui/use-action-result"

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
 * Selection drives a single server action; the total updates locally so the
 * founder sees exactly what the batch will contain before committing.
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
  const [selected, setSelected] = useState<string[]>(() => rows.map((r) => r.participationId))
  const [state, action, pending] = useActionState(createPayoutBatchAction, INITIAL)

  useActionResult(state)

  const total = rows
    .filter((row) => selected.includes(row.participationId))
    .reduce((sum, row) => sum + row.amountMinor, 0)

  const allSelected = selected.length === rows.length && rows.length > 0

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
              <TH className="w-8">
                <input
                  type="checkbox"
                  aria-label={t("selectAll")}
                  checked={allSelected}
                  onChange={(event) =>
                    setSelected(event.target.checked ? rows.map((r) => r.participationId) : [])
                  }
                  className="size-3.5 accent-primary touch:size-4.5"
                />
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
                <TR key={row.participationId}>
                  <TD>
                    <input
                      id={inputId}
                      type="checkbox"
                      aria-label={t("include", { name: row.affiliateName })}
                      checked={checked}
                      onChange={(event) =>
                        setSelected((previous) =>
                          event.target.checked
                            ? [...previous, row.participationId]
                            : previous.filter((id) => id !== row.participationId),
                        )
                      }
                      className="size-3.5 accent-primary touch:size-4.5"
                    />
                  </TD>
                  <TD className="max-md:py-2.5">
                    <label htmlFor={inputId} className="block">
                      <span className="block truncate text-foreground">{row.affiliateName}</span>
                      <span className="block font-mono text-label text-muted-foreground">
                        {row.code}
                        <span className="font-sans md:hidden">
                          {" · "}
                          {t("commissions")} {f.number(row.commissionCount)}
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
        <p className="text-caption tabular-nums text-muted-foreground">
          {t("selection", { selected: selected.length, total: rows.length })}
          {" · "}
          <span className="text-foreground">{f.money(total, currency)}</span>
        </p>
        <Button type="submit" variant="primary" loading={pending} disabled={selected.length === 0}>
          {t("submit")}
        </Button>
      </div>
    </form>
  )
}
