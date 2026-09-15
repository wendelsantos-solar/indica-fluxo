"use client"

import { Plus } from "lucide-react"
import { useTranslations } from "next-intl"
import type * as React from "react"
import { useActionState, useState } from "react"

import { InlineAlert } from "@/components/feedback/inline-alert"
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
import { Input, Select } from "@/components/ui/input"
import { useActionResult } from "@/components/ui/use-action-result"

import { inviteAffiliateAction, type AffiliateFormState } from "./actions"

const INITIAL: AffiliateFormState = {}

const EMPTY = { name: "", email: "", code: "", customRate: "", companyName: "" }

export function InviteAffiliateDialog({
  workspaceSlug,
  programs,
  defaultProgramId,
  triggerLabel,
  triggerVariant = "primary",
  triggerSize = "sm",
}: {
  workspaceSlug: string
  programs: { id: string; name: string }[]
  defaultProgramId?: string
  /** Defaults to the translated "Invite affiliate" — one verb everywhere. */
  triggerLabel?: string
  /** Page headers use the small amber trigger; an empty state may want `md`. */
  triggerVariant?: "primary" | "secondary"
  triggerSize?: "sm" | "md"
}) {
  const t = useTranslations("forms.inviteAffiliate")
  const ta = useTranslations("common.actions")
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(inviteAffiliateAction, INITIAL)

  // Controlled, so a failed submission keeps what was typed instead of being
  // wiped when React resets the form after the action.
  const [programId, setProgramId] = useState(defaultProgramId ?? programs[0]?.id ?? "")
  const [values, setValues] = useState(EMPTY)
  const set = (key: keyof typeof EMPTY) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setValues((current) => ({ ...current, [key]: event.target.value }))

  // Success closes the dialog, so it is announced by a toast; errors stay
  // inline in the dialog and never toast as well.
  useActionResult(state, {
    onSuccess: () => {
      setOpen(false)
      setValues(EMPTY)
    },
    toastOnError: false,
  })

  if (programs.length === 0) return null

  const errors = state.fieldErrors ?? {}
  const error = (field: string) => errors[field]?.[0]
  const describedBy = (field: string, hasHint = false) =>
    errors[field] ? `${field}-error` : hasHint ? `${field}-hint` : undefined

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size={triggerSize}>
          <Plus aria-hidden="true" />
          {triggerLabel ?? t("submit")}
        </Button>
      </DialogTrigger>

      <DialogContent size="form">
        <form action={action} noValidate className="flex min-h-0 flex-col">
          <input type="hidden" name="workspaceSlug" value={workspaceSlug} />

          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>

          <DialogBody>
            <Field label={t("program")} htmlFor="programId" required error={error("programId")}>
              <Select
                id="programId"
                name="programId"
                value={programId}
                onChange={(event) => setProgramId(event.target.value)}
                required
                aria-invalid={errors.programId ? true : undefined}
                aria-describedby={describedBy("programId")}
              >
                {programs.map((program) => (
                  <option key={program.id} value={program.id}>
                    {program.name}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("name")} htmlFor="name" required error={error("name")}>
                <Input
                  id="name"
                  name="name"
                  value={values.name}
                  onChange={set("name")}
                  autoComplete="off"
                  required
                  aria-describedby={describedBy("name")}
                  invalid={Boolean(errors.name)}
                />
              </Field>

              <Field label={t("email")} htmlFor="email" required error={error("email")}>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  value={values.email}
                  onChange={set("email")}
                  autoComplete="off"
                  required
                  aria-describedby={describedBy("email")}
                  invalid={Boolean(errors.email)}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("code")} htmlFor="code" hint={t("codeHint")} error={error("code")}>
                <Input
                  id="code"
                  name="code"
                  value={values.code}
                  onChange={set("code")}
                  placeholder={t("codePlaceholder")}
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-describedby={describedBy("code", true)}
                  invalid={Boolean(errors.code)}
                  className="font-mono"
                />
              </Field>

              <Field
                label={t("customRate")}
                htmlFor="customRate"
                hint={t("customRateHint")}
                error={error("customRate")}
              >
                <Input
                  id="customRate"
                  name="customRate"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  step="0.5"
                  value={values.customRate}
                  onChange={set("customRate")}
                  aria-describedby={describedBy("customRate", true)}
                  invalid={Boolean(errors.customRate)}
                  className="tabular-nums"
                />
              </Field>
            </div>

            <Field label={t("company")} htmlFor="companyName" hint={t("optional")} error={error("companyName")}>
              <Input
                id="companyName"
                name="companyName"
                value={values.companyName}
                onChange={set("companyName")}
                aria-describedby={describedBy("companyName", true)}
                invalid={Boolean(errors.companyName)}
              />
            </Field>

            {state.error ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {ta("cancel")}
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
