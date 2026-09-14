import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react"
import type * as React from "react"

import { cn } from "@/lib/utils"

const TONES = {
  info: { icon: Info, edge: "border-l-info", iconClass: "text-info-foreground", role: "note" },
  success: { icon: CircleCheck, edge: "border-l-success", iconClass: "text-success-foreground", role: "note" },
  warning: { icon: TriangleAlert, edge: "border-l-warning", iconClass: "text-warning-foreground", role: "note" },
  danger: { icon: CircleAlert, edge: "border-l-danger", iconClass: "text-danger-foreground", role: "note" },
} as const

/**
 * A note the reader must not miss. Hairline box with a 2px tone edge and an
 * icon — the label and text carry the meaning, colour only marks it. Use
 * sparingly: a page of callouts is a page with none.
 */
export function Callout({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: keyof typeof TONES
  title: string
  children: React.ReactNode
  className?: string
}) {
  const { icon: Icon, edge, iconClass, role } = TONES[tone]
  return (
    <aside
      role={role}
      aria-label={title}
      className={cn(
        "flex gap-3 rounded-control border border-l-2 border-border bg-surface-1 px-4 py-3",
        edge,
        className,
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", iconClass)} aria-hidden="true" />
      <div className="min-w-0 text-caption leading-relaxed">
        <p className="font-medium text-foreground">{title}</p>
        <div className="mt-1 text-foreground-secondary [&_p+p]:mt-2">{children}</div>
      </div>
    </aside>
  )
}
