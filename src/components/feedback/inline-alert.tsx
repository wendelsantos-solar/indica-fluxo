import { CircleAlert, CircleCheck, Info } from "lucide-react"
import type * as React from "react"

import { cn } from "@/lib/utils"

const TONES = {
  danger: { icon: CircleAlert, border: "border-danger/30", iconClass: "text-danger-foreground", role: "alert" },
  success: { icon: CircleCheck, border: "border-success/30", iconClass: "text-success-foreground", role: "status" },
  info: { icon: Info, border: "border-border", iconClass: "text-muted-foreground", role: "status" },
} as const

/**
 * The one inline message style: a hairline box with an icon, used for a form's
 * error or success and for page-level notices. Never colour alone — the text
 * carries the meaning, the tone only tints the edge and the icon.
 */
export function InlineAlert({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: keyof typeof TONES
  title?: string
  children?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  const { icon: Icon, border, iconClass, role } = TONES[tone]
  return (
    <div
      role={role}
      className={cn("flex items-start gap-2.5 rounded-control border bg-surface-1 px-3 py-2.5", border, className)}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", iconClass)} aria-hidden="true" />
      <div className="min-w-0 flex-1 text-caption">
        {title ? <p className="font-medium text-foreground">{title}</p> : null}
        {children ? <div className={cn("text-foreground-secondary", title && "mt-0.5 text-muted-foreground")}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  )
}
