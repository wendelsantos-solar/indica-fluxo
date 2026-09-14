"use client"

import { Ban, Check, MoreHorizontal, Pause, Percent } from "lucide-react"
import { useTranslations } from "next-intl"
import * as React from "react"
import { useActionState, useRef, useState, useTransition } from "react"

import { InlineAlert } from "@/components/feedback/inline-alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
  DropdownTrigger,
} from "@/components/ui/dropdown"
import { Field } from "@/components/ui/field"
import { Input, Select } from "@/components/ui/input"
import { useActionResult } from "@/components/ui/use-action-result"
import { useFormatters } from "@/i18n/use-formatters"
import { minorUnitExponent } from "@/lib/money"
import {
  allowedParticipationTransitions,
  type ParticipationStatus,
} from "@/server/domain/participation"

import {
  setCustomRateAction,
  setParticipationStatusAction,
  type AffiliateFormState,
  type CustomRateFormState,
} from "./actions"
import { customRateToInput, type CustomRateType } from "./custom-rate"

interface Rate {
  type: CustomRateType
  value: number
}

export interface AffiliateRowActionsProps {
  workspaceSlug: string
  participationId: string
  affiliateName: string
  programName: string
  status: ParticipationStatus
  /** The program's currency: a fixed rate is entered and stored in it. */
  currency: string
  programRate: Rate | null
  customRate: Rate | null
}

type Confirmable = "suspended" | "rejected"

const DANGER_ITEM =
  "text-danger-foreground data-[highlighted]:text-danger-foreground [&_svg]:text-danger-foreground"

/**
 * The per-row menu on the founder's affiliate list: approve, suspend, reject,
 * and the special rate. Suspending and rejecting are confirmed in a dialog
 * that says what happens to the affiliate's earnings; approving is not
 * destructive and runs straight away, reporting back with a toast.
 *
 * Only rendered for owners and admins — the services refuse anyone else.
 */
export function AffiliateRowActions(props: AffiliateRowActionsProps) {
  const t = useTranslations("forms.affiliateActions")
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [dialog, setDialog] = useState<Confirmable | "rate" | null>(null)
  const [approveState, setApproveState] = useState<AffiliateFormState>({})
  const [approving, startApprove] = useTransition()

  // Approving has no dialog to show its outcome in, so both results toast.
  useActionResult(approveState)

  const allowed = allowedParticipationTransitions(props.status)

  const approve = () =>
    startApprove(async () => {
      const formData = new FormData()
      formData.set("workspaceSlug", props.workspaceSlug)
      formData.set("participationId", props.participationId)
      formData.set("status", "approved")
      setApproveState(await setParticipationStatusAction({}, formData))
    })

  // The dialogs have no trigger of their own; give focus back to the menu
  // button they were opened from (DESIGN.md §12).
  const restoreFocus = (event: Event) => {
    event.preventDefault()
    triggerRef.current?.focus()
  }

  const close = () => setDialog(null)

  return (
    <>
      <Dropdown modal={false}>
        <DropdownTrigger asChild ref={triggerRef}>
          <Button
            variant="ghost"
            size="icon-sm"
            loading={approving}
            aria-label={t("menuLabel", { name: props.affiliateName })}
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownTrigger>
        <DropdownContent align="end">
          {allowed.includes("approved") ? (
            <DropdownItem onSelect={approve}>
              <Check aria-hidden="true" />
              {t("approve")}
            </DropdownItem>
          ) : null}
          <DropdownItem onSelect={() => setDialog("rate")}>
            <Percent aria-hidden="true" />
            {t("customRate")}
          </DropdownItem>
          {allowed.includes("suspended") || allowed.includes("rejected") ? <DropdownSeparator /> : null}
          {allowed.includes("suspended") ? (
            <DropdownItem className={DANGER_ITEM} onSelect={() => setDialog("suspended")}>
              <Pause aria-hidden="true" />
              {t("suspend")}
            </DropdownItem>
          ) : null}
          {allowed.includes("rejected") ? (
            <DropdownItem className={DANGER_ITEM} onSelect={() => setDialog("rejected")}>
              <Ban aria-hidden="true" />
              {t("reject")}
            </DropdownItem>
          ) : null}
        </DropdownContent>
      </Dropdown>

      <Dialog open={dialog === "suspended" || dialog === "rejected"} onOpenChange={(open) => !open && close()}>
        <DialogContent onCloseAutoFocus={restoreFocus}>
          {dialog === "suspended" || dialog === "rejected" ? (
            <StatusConfirmForm {...props} target={dialog} onDone={close} />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "rate"} onOpenChange={(open) => !open && close()}>
        <DialogContent size="form" onCloseAutoFocus={restoreFocus}>
          {dialog === "rate" ? <CustomRateForm {...props} onDone={close} /> : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * Mounted only while its dialog is open, so every opening starts from a clean
 * action state instead of showing the previous attempt's error.
 */
function StatusConfirmForm({
  workspaceSlug,
  participationId,
  affiliateName,
  programName,
  target,
  onDone,
}: AffiliateRowActionsProps & { target: Confirmable; onDone: () => void }) {
  const t = useTranslations("forms.affiliateActions")
  const ta = useTranslations("common.actions")
  const [state, action, pending] = useActionState(setParticipationStatusAction, {})

  // The dialog closes on success and the row's badge changes; a toast confirms.
  // A failure stays inline, in the dialog, and does not toast as well.
  useActionResult(state, { onSuccess: onDone, toastOnError: false })

  const copy =
    target === "suspended"
      ? { title: t("suspendTitle", { name: affiliateName }), body: t("suspendBody", { name: affiliateName, program: programName }), confirm: t("suspendConfirm") }
      : { title: t("rejectTitle", { name: affiliateName }), body: t("rejectBody", { name: affiliateName, program: programName }), confirm: t("rejectConfirm") }

  return (
    <form action={action} className="flex min-h-0 flex-col">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="participationId" value={participationId} />
      <input type="hidden" name="status" value={target} />

      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <DialogDescription className="text-ui text-foreground-secondary">{copy.body}</DialogDescription>
        {state.error ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary" autoFocus disabled={pending}>
            {ta("cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" variant="destructive" loading={pending}>
          {copy.confirm}
        </Button>
      </DialogFooter>
    </form>
  )
}

function CustomRateForm({
  workspaceSlug,
  participationId,
  affiliateName,
  programName,
  currency,
  programRate,
  customRate,
  onDone,
}: AffiliateRowActionsProps & { onDone: () => void }) {
  const t = useTranslations("forms.customRate")
  const ta = useTranslations("common.actions")
  const f = useFormatters()
  const [state, action, pending] = useActionState<CustomRateFormState, FormData>(setCustomRateAction, {})
  const formRef = useRef<HTMLFormElement>(null)

  // Controlled, so a failed submission keeps what was typed (React resets an
  // uncontrolled form after its action returns).
  const [type, setType] = useState<CustomRateType>(customRate?.type ?? "percentage")
  const [value, setValue] = useState(
    customRate ? customRateToInput(customRate.type, customRate.value, currency) : "",
  )

  useActionResult(state, { onSuccess: onDone, toastOnError: false })

  const describe = (rate: Rate) =>
    rate.type === "percentage" ? f.basisPoints(rate.value) : f.money(rate.value, currency)

  const valueError = state.fieldErrors?.value?.[0]
  const fieldId = `custom-rate-${participationId}`
  const exponent = minorUnitExponent(currency)

  // Enter in the amount always saves; it must never reach "Remove", which comes
  // first in the footer.
  const onValueKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return
    event.preventDefault()
    const form = formRef.current
    form?.requestSubmit(form.querySelector<HTMLButtonElement>('button[name="intent"][value="set"]'))
  }

  return (
    <form ref={formRef} action={action} noValidate className="flex min-h-0 flex-col">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="participationId" value={participationId} />
      <input type="hidden" name="currency" value={currency} />

      <DialogHeader>
        <DialogTitle>{t("title", { name: affiliateName })}</DialogTitle>
        <DialogDescription>
          {programRate
            ? t("description", { program: programName, rate: describe(programRate) })
            : t("descriptionNoRate", { program: programName })}
        </DialogDescription>
      </DialogHeader>

      <DialogBody>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("type")} htmlFor={`${fieldId}-type`}>
            <Select
              id={`${fieldId}-type`}
              name="type"
              value={type}
              onChange={(event) => setType(event.target.value as CustomRateType)}
            >
              <option value="percentage">{t("typePercentage")}</option>
              <option value="fixed">{t("typeFixed", { currency })}</option>
            </Select>
          </Field>

          <Field
            label={type === "percentage" ? t("valuePercentage") : t("valueFixed", { currency })}
            htmlFor={`${fieldId}-value`}
            hint={type === "percentage" ? t("hintPercentage") : t("hintFixed")}
            error={valueError}
          >
            <Input
              id={`${fieldId}-value`}
              name="value"
              type="number"
              inputMode="decimal"
              min="0"
              max={type === "percentage" ? "100" : undefined}
              step={type === "percentage" || exponent > 0 ? "0.01" : "1"}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={onValueKeyDown}
              autoComplete="off"
              invalid={Boolean(valueError)}
              aria-describedby={`${fieldId}-value-${valueError ? "error" : "hint"}`}
              className="tabular-nums"
            />
          </Field>
        </div>

        {customRate ? (
          <p className="text-meta text-muted-foreground">
            {t("current", { rate: describe(customRate) })}
          </p>
        ) : null}

        {state.error ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
      </DialogBody>

      <DialogFooter>
        {customRate ? (
          <Button
            type="submit"
            name="intent"
            value="clear"
            variant="danger"
            disabled={pending}
            className="sm:mr-auto"
          >
            {t("remove")}
          </Button>
        ) : null}
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            {ta("cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" name="intent" value="set" variant="primary" loading={pending}>
          {t("save")}
        </Button>
      </DialogFooter>
    </form>
  )
}
