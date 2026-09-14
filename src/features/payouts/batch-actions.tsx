"use client"

import { useActionState, useState } from "react"

import { Button } from "@/components/ui/button"
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
import { formatMoney } from "@/lib/money"

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
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(markBatchPaidAction, INITIAL)

  useActionResult(state, { onSuccess: () => setOpen(false) })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary" size="sm">
          Mark as paid
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action}>
          <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
          <input type="hidden" name="batchId" value={batchId} />

          <DialogHeader>
            <DialogTitle>Mark {reference} as paid?</DialogTitle>
            <DialogDescription>
              This records that you paid {affiliateCount} affiliate
              {affiliateCount === 1 ? "" : "s"} a total of{" "}
              {formatMoney(totalAmountMinor, currency)} outside the platform. The commissions in
              this batch become <strong>paid</strong> and this cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            <Field
              label="Payment reference"
              htmlFor="externalReference"
              hint="Optional. A Wise transfer id, bank reference or invoice number."
            >
              <Input id="externalReference" name="externalReference" className="font-mono" />
            </Field>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              Yes, mark as paid
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
  const [state, action, pending] = useActionState(cancelBatchAction, INITIAL)

  useActionResult(state)

  return (
    <form action={action}>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="batchId" value={batchId} />
      <Button type="submit" variant="ghost" size="sm" loading={pending}>
        Cancel
      </Button>
    </form>
  )
}
