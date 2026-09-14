import type { LucideIcon } from "lucide-react"
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
      <div className="flex size-10 items-center justify-center rounded-[8px] border border-border bg-surface-2">
        <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="text-[15px] font-medium text-foreground">{title}</p>
        <p className="mx-auto max-w-sm text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}

export function ErrorState({
  title = "Something went wrong",
  description,
  action,
}: {
  title?: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center"
    >
      <div className="flex size-10 items-center justify-center rounded-[8px] bg-danger-subtle">
        <span aria-hidden="true" className="text-[15px] text-danger-foreground">
          !
        </span>
      </div>
      <div className="space-y-1">
        <p className="text-[15px] font-medium text-foreground">{title}</p>
        <p className="mx-auto max-w-sm text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  )
}
