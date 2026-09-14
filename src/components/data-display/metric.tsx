import { ArrowDown, ArrowUp } from "lucide-react"
import { useLocale } from "next-intl"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * DESIGN.md §9: label → value → delta with its comparison period.
 * Plain-case label, tabular value, no card around it: metrics read as a
 * hairline strip, not a grid of tiles. A metric without a comparison is a
 * missed opportunity, not a feature.
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
  const locale = useLocale()
  const hasDelta = typeof delta === "number" && Number.isFinite(delta)
  const positive = hasDelta && delta > 0
  const negative = hasDelta && delta < 0

  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <p className="truncate text-caption text-muted-foreground">{label}</p>
      <p
        className={cn(
          "whitespace-nowrap tabular-nums text-foreground",
          size === "lg" ? "text-heading-sm" : "text-title",
        )}
      >
        {value}
      </p>
      {hasDelta || comparison ? (
        <p className="flex items-center gap-1.5 text-meta">
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
              {new Intl.NumberFormat(locale, {
                style: "percent",
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
                signDisplay: "exceptZero",
              }).format(delta / 100)}
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
        "grid grid-cols-2 gap-x-6 border-y border-border sm:grid-cols-3",
        className,
      )}
      {...props}
    />
  )
}

export function MetricCell({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("py-4", className)} {...props} />
}
