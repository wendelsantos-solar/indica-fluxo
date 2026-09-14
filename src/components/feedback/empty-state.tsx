import { CircleAlert, type LucideIcon } from "lucide-react"
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
        "flex flex-col items-center justify-center px-6 py-16 text-center",
        className,
      )}
    >
      <div className="mb-4 flex size-10 items-center justify-center rounded-panel border border-border bg-surface-1 text-muted-foreground">
        <Icon className="size-4.5" aria-hidden="true" />
      </div>
      <p className="text-ui font-medium text-foreground">{title}</p>
      <p className="mt-1.5 max-w-[46ch] text-caption text-muted-foreground">{description}</p>
      {action ? <div className="mt-5 flex gap-2">{action}</div> : null}
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
      className="flex flex-col items-center justify-center px-6 py-16 text-center"
    >
      <div className="mb-4 flex size-10 items-center justify-center rounded-panel border border-danger/30 bg-surface-1 text-danger-foreground">
        <CircleAlert className="size-4.5" aria-hidden="true" />
      </div>
      <p className="text-ui font-medium text-foreground">{title ?? t("errorTitle")}</p>
      <p className="mt-1.5 max-w-[46ch] text-caption text-muted-foreground">{description}</p>
      {action ? <div className="mt-5 flex gap-2">{action}</div> : null}
    </div>
  )
}
