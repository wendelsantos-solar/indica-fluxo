"use client"

import { Pencil, Trash2 } from "lucide-react"
import { useTranslations } from "next-intl"
import * as React from "react"
import { useActionState } from "react"

import { InlineAlert } from "@/components/feedback/inline-alert"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  Dialog,
  DialogBody,
  DialogClose,
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
import { deleteLinkAction, renameLinkAction, type LinkFormState } from "@/features/portal/actions"

const INITIAL: LinkFormState = {}

/**
 * Rename and delete for one named link. Renaming changes the label only — the
 * URL already shared keeps working — and deleting is confirmed, with the
 * consequence stated: the link stops being counted on its own, the clicks and
 * earnings it brought stay.
 */
export function LinkActions({ linkId, name }: { linkId: string; name: string }) {
  return (
    <div className="flex items-center justify-end gap-1">
      <RenameLinkDialog linkId={linkId} name={name} />
      <DeleteLink linkId={linkId} name={name} />
    </div>
  )
}

function RenameLinkDialog({ linkId, name }: { linkId: string; name: string }) {
  const t = useTranslations("portal.links")
  const tf = useTranslations("forms.createLink")
  const ta = useTranslations("common.actions")
  const [open, setOpen] = React.useState(false)
  const [state, action, pending] = useActionState(renameLinkAction, INITIAL)
  const inputId = `link-rename-${linkId}`

  useActionResult(state, { toastOnError: false, onSuccess: () => setOpen(false) })

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label={t("renameLabel", { name })} className="max-sm:h-11">
          <Pencil aria-hidden="true" />
          {t("rename")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action} noValidate className="flex min-h-0 flex-col">
          <input type="hidden" name="linkId" value={linkId} />
          <DialogHeader>
            <DialogTitle>{t("renameTitle")}</DialogTitle>
            <DialogDescription>{t("renameDescription")}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label={tf("name")} htmlFor={inputId} error={state.fieldErrors?.name?.[0]}>
              <Input
                id={inputId}
                name="name"
                defaultValue={name}
                maxLength={80}
                autoComplete="off"
                autoFocus
                invalid={Boolean(state.fieldErrors?.name?.length)}
                aria-describedby={state.fieldErrors?.name?.length ? `${inputId}-error` : undefined}
              />
            </Field>
            {state.error ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={pending}>
                {ta("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" variant="primary" loading={pending}>
              {t("renameSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteLink({ linkId, name }: { linkId: string; name: string }) {
  const t = useTranslations("portal.links")
  const [state, setState] = React.useState<LinkFormState>(INITIAL)

  // The dialog closes when the action settles, so the outcome is a toast.
  useActionResult(state)

  return (
    <ConfirmDialog
      trigger={
        <>
          <Trash2 aria-hidden="true" />
          <span className="sr-only">{t("deleteLabel", { name })}</span>
          <span aria-hidden="true">{t("delete")}</span>
        </>
      }
      triggerVariant="ghost"
      title={t("deleteTitle", { name })}
      description={t("deleteDescription")}
      confirmLabel={t("deleteConfirm")}
      action={async (formData) => setState(await deleteLinkAction(INITIAL, formData))}
    >
      <input type="hidden" name="linkId" value={linkId} />
    </ConfirmDialog>
  )
}
