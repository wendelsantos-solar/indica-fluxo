"use client"

import { useTranslations } from "next-intl"
import * as React from "react"

import { Button, type ButtonProps } from "@/components/ui/button"
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

/**
 * A destructive or irreversible action behind one confirmation — DESIGN.md §9
 * Dialog. The trigger is quiet (`danger` hairline by default); the solid danger
 * button only exists inside the dialog, on the right, next to a neutral cancel
 * that receives focus first so Enter never confirms by accident.
 *
 * `action` is a server action (or form action) bound to a hidden-field form;
 * pass the fields as `children`. The dialog closes when the action settles.
 *
 * Without a `trigger`, the dialog is controlled (`open` / `onOpenChange`): a
 * form that must confirm a consequential change before submitting opens it
 * itself, and its `action` resumes the submission.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  action,
  children,
  tone = "danger",
  triggerVariant = "danger",
  triggerSize = "sm",
  open: controlledOpen,
  onOpenChange,
}: {
  /** Label (and optional icon) of the button that opens the dialog. Omit for a controlled dialog. */
  trigger?: React.ReactNode
  title: string
  /** State the consequence in plain language. */
  description: string
  confirmLabel: string
  action: (formData: FormData) => void | Promise<void>
  /** Hidden inputs carried to the action. */
  children?: React.ReactNode
  tone?: "danger" | "primary"
  triggerVariant?: ButtonProps["variant"]
  triggerSize?: ButtonProps["size"]
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const t = useTranslations("common.actions")
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      {trigger !== undefined ? (
        <DialogTrigger asChild>
          <Button type="button" variant={triggerVariant} size={triggerSize}>
            {trigger}
          </Button>
        </DialogTrigger>
      ) : null}
      <DialogContent>
        <form
          action={(formData) =>
            startTransition(async () => {
              await action(formData)
              setOpen(false)
            })
          }
          className="flex min-h-0 flex-col"
        >
          {children}
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <DialogDescription className="text-ui text-foreground-secondary">{description}</DialogDescription>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary" autoFocus disabled={pending}>
                {t("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" variant={tone === "danger" ? "destructive" : "primary"} loading={pending}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
