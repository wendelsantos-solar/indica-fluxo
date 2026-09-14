"use client"

import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { useTranslations } from "next-intl"
import * as React from "react"

import { cn } from "@/lib/utils"

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  const t = useTranslations("common.actions")

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-50 bg-scrim",
          "data-[state=open]:animate-[overlay-in_140ms_ease-out]",
        )}
      />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-1rem)] max-w-[480px] outline-none",
          "-translate-x-1/2 -translate-y-1/2",
          "rounded-panel bg-surface-3 shadow-overlay",
          "data-[state=open]:animate-[dialog-in_180ms_var(--ease-out-quint)]",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute right-2.5 top-2.5 inline-flex size-7 items-center justify-center rounded-control text-faint-foreground transition-colors hover:bg-hover hover:text-foreground touch:size-10"
          aria-label={t("closeDialog")}
        >
          <X className="size-4" aria-hidden="true" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-0.5 border-b border-border px-4 py-3", className)} {...props} />
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("pr-8 text-ui font-medium text-foreground", className)}
      {...props}
    />
  )
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-caption text-muted-foreground", className)}
      {...props}
    />
  )
}

export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-4 p-4", className)} {...props} />
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 border-t border-border px-4 py-3 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  )
}
