"use client"

import { useTranslations } from "next-intl"
import { useActionState, useState } from "react"

import { Button } from "@/components/ui/button"
import { useFormatters } from "@/i18n/use-formatters"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useActionResult } from "@/components/ui/use-action-result"

import { cancelBatchAction, markBatchPaidAction, type PayoutFormState } from "./actions"

const INITIAL: PayoutFormState = {}

/**
 * Marking a batch paid is irreversible bookkeeping, so it is confirmed in a
 * dialog that states the consequence in plain language — DESIGN.md §9.
 */
export function MarkPaidDialog({
  workspaceSlug,
  batchId,
  reference,
  affiliateCount,
  totalAmountMinor,
  currency,
}: {
  workspaceSlug: string
  batchId: string
  reference: string
  affiliateCount: number
  totalAmountMinor: number
  currency: string
}) {
  const t = useTranslations("forms.batch")
  const ta = useTranslations("common.actions")
  const f = useFormatters()
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(markBatchPaidAction, INITIAL)

  useActionResult(state, { onSuccess: () => setOpen(false) })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary" size="sm">
          {t("markPaid")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action}>
          <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
          <input type="hidden" name="batchId" value={batchId} />

          <DialogHeader>
            <DialogTitle>{t("confirmTitle", { reference })}</DialogTitle>
            <DialogDescription>
              {t.rich("confirmBody", {
                count: affiliateCount,
                amount: f.money(totalAmountMinor, currency),
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            <Field
              label={t("reference")}
              htmlFor="externalReference"
              hint={t("referenceHint")}
            >
              <Input id="externalReference" name="externalReference" className="font-mono" />
            </Field>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {ta("cancel")}
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              {t("confirmAction")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CancelBatchButton({
  workspaceSlug,
  batchId,
}: {
  workspaceSlug: string
  batchId: string
}) {
  const t = useTranslations("forms.batch")
  const [state, action, pending] = useActionState(cancelBatchAction, INITIAL)

  useActionResult(state)

  return (
    <form action={action}>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="batchId" value={batchId} />
      <Button type="submit" variant="ghost" size="sm" loading={pending}>
        {t("cancelBatch")}
      </Button>
    </form>
  )
}
