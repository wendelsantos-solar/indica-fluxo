"use client"

import { Plus } from "lucide-react"
import { useTranslations } from "next-intl"
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
import { Input, Select } from "@/components/ui/input"
import { useActionResult } from "@/components/ui/use-action-result"

import { inviteAffiliateAction, type AffiliateFormState } from "./actions"

const INITIAL: AffiliateFormState = {}

export function InviteAffiliateDialog({
  workspaceSlug,
  programs,
  defaultProgramId,
  triggerLabel = "Invite affiliate",
}: {
  workspaceSlug: string
  programs: { id: string; name: string }[]
  defaultProgramId?: string
  triggerLabel?: string
}) {
  const t = useTranslations("forms.inviteAffiliate")
  const ta = useTranslations("common.actions")
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(inviteAffiliateAction, INITIAL)

  useActionResult(state, { onSuccess: () => setOpen(false) })

  if (programs.length === 0) return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary">
          <Plus aria-hidden="true" />
          {triggerLabel}
        </Button>
      </DialogTrigger>

      <DialogContent>
        <form action={action} noValidate>
          <input type="hidden" name="workspaceSlug" value={workspaceSlug} />

          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>

          <DialogBody>
            <Field label={t("program")} htmlFor="programId" required>
              <Select id="programId" name="programId" defaultValue={defaultProgramId} required>
                {programs.map((program) => (
                  <option key={program.id} value={program.id}>
                    {program.name}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("name")} htmlFor="name" required error={state.fieldErrors?.name?.[0]}>
                <Input id="name" name="name" required invalid={Boolean(state.fieldErrors?.name)} />
              </Field>

              <Field label={t("email")} htmlFor="email" required error={state.fieldErrors?.email?.[0]}>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  invalid={Boolean(state.fieldErrors?.email)}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t("code")}
                htmlFor="code"
                hint={t("codeHint")}
                error={state.fieldErrors?.code?.[0]}
              >
                <Input id="code" name="code" placeholder={t("codePlaceholder")} className="font-mono" />
              </Field>

              <Field
                label={t("customRate")}
                htmlFor="customRate"
                hint={t("customRateHint")}
                error={state.fieldErrors?.customRate?.[0]}
              >
                <Input id="customRate" name="customRate" type="number" min="0" max="100" step="0.5" />
              </Field>
            </div>

            <Field label={t("company")} htmlFor="companyName" hint={t("optional")}>
              <Input id="companyName" name="companyName" />
            </Field>

            {state.error ? (
              <p role="alert" className="rounded-control bg-danger-subtle px-3 py-2 text-meta text-danger-foreground">
                {state.error}
              </p>
            ) : null}
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
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
