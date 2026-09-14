import { ArrowDown, ArrowUp } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * DESIGN.md §9: label → value → delta with its comparison period.
 * A metric without a comparison is a missed opportunity, not a feature.
 */
export function Metric({
  label,
  value,
  delta,
  comparison,
  size = "md",
  className,
  children,
}: {
  label: string
  value: string
  delta?: number | null
  comparison?: string
  size?: "md" | "lg"
  className?: string
  children?: React.ReactNode
}) {
  const hasDelta = typeof delta === "number" && Number.isFinite(delta)
  const positive = hasDelta && delta > 0
  const negative = hasDelta && delta < 0

  return (
    <div className={cn("space-y-1.5", className)}>
      <p className="text-[11px] font-medium uppercase tracking-[0.02em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "font-medium tabular-nums tracking-tight text-foreground",
          size === "lg" ? "text-[40px] leading-none" : "text-[26px] leading-none",
        )}
      >
        {value}
      </p>
      {hasDelta || comparison ? (
        <p className="flex items-center gap-1.5 text-[12px]">
          {hasDelta ? (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 font-medium tabular-nums",
                positive && "text-success-foreground",
                negative && "text-danger-foreground",
                !positive && !negative && "text-muted-foreground",
              )}
            >
              {positive ? (
                <ArrowUp className="size-3" aria-hidden="true" />
              ) : negative ? (
                <ArrowDown className="size-3" aria-hidden="true" />
              ) : null}
              {positive ? "+" : ""}
              {delta.toFixed(1)}%
            </span>
          ) : null}
          {comparison ? <span className="text-muted-foreground">{comparison}</span> : null}
        </p>
      ) : null}
      {children}
    </div>
  )
}

export function MetricGrid({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border",
        "lg:grid-cols-3",
        className,
      )}
      {...props}
    />
  )
}

export function MetricCell({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("bg-surface-1 p-5", className)} {...props} />
}
