"use client"

import { useTranslations } from "next-intl"
import { useActionState, useState } from "react"

import { InlineAlert } from "@/components/feedback/inline-alert"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
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
import { useFormatters } from "@/i18n/use-formatters"

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

  // The dialog stays open on failure and says why inline; success closes it
  // and the row itself changes, so a toast confirms off-screen.
  useActionResult(state, { onSuccess: () => setOpen(false), toastOnError: false })

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <DialogTrigger asChild>
        {/* Secondary in the row: the page's amber action is creating a batch. */}
        <Button variant="secondary" size="sm">
          {t("markPaid")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action} className="flex min-h-0 flex-col">
          <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
          <input type="hidden" name="batchId" value={batchId} />

          <DialogHeader>
            <DialogTitle>{t("confirmTitle", { reference })}</DialogTitle>
            <DialogDescription>
              {t.rich("confirmBody", {
                count: affiliateCount,
                amount: f.money(totalAmountMinor, currency),
                strong: (chunks) => <strong className="font-medium text-foreground">{chunks}</strong>,
              })}
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            <Field label={t("reference")} htmlFor={`externalReference-${batchId}`} hint={t("referenceHint")}>
              <Input
                id={`externalReference-${batchId}`}
                name="externalReference"
                className="font-mono"
                autoComplete="off"
                aria-describedby={`externalReference-${batchId}-hint`}
              />
            </Field>
            {state.error ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
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

/**
 * Cancelling a batch returns its commissions to "available". The trigger says
 * "Cancel batch" rather than "Cancel", so it never reads like the dialog's own
 * dismiss button, and the confirmation spells out what happens to the money.
 */
export function CancelBatchButton({
  workspaceSlug,
  batchId,
  reference,
}: {
  workspaceSlug: string
  batchId: string
  reference: string
}) {
  const t = useTranslations("forms.batch")
  const [state, setState] = useState<PayoutFormState>(INITIAL)

  // The dialog closes when the action settles, so the outcome is a toast.
  useActionResult(state)

  return (
    <ConfirmDialog
      trigger={t("cancelBatch")}
      triggerVariant="danger"
      title={t("cancelTitle", { reference })}
      description={t("cancelBody")}
      confirmLabel={t("cancelConfirm")}
      action={async (formData) => setState(await cancelBatchAction(INITIAL, formData))}
    >
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="batchId" value={batchId} />
    </ConfirmDialog>
  )
}
