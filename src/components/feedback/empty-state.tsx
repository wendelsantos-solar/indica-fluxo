import type { LucideIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * DESIGN.md §9: icon tile, headline, one sentence, one action. No illustration,
 * never a second competing action.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon
  title: string
  description: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-14 text-center",
        className,
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-control border border-border bg-surface-2">
        <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="text-body-sm font-medium text-foreground">{title}</p>
        <p className="mx-auto max-w-sm text-caption leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}

export function ErrorState({
  title,
  description,
  action,
}: {
  /** Defaults to the translated "Something went wrong". */
  title?: string
  description: string
  action?: React.ReactNode
}) {
  const t = useTranslations("common.feedback")

  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center"
    >
      <div className="flex size-10 items-center justify-center rounded-control bg-danger-subtle">
        <span aria-hidden="true" className="text-body-sm text-danger-foreground">
          !
        </span>
      </div>
      <div className="space-y-1">
        <p className="text-body-sm font-medium text-foreground">{title ?? t("errorTitle")}</p>
        <p className="mx-auto max-w-sm text-caption leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  )
}
