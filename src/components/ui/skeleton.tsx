import * as React from "react"

import { cn } from "@/lib/utils"

/** Shapes must match the content they replace — DESIGN.md §9. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative overflow-hidden rounded-[6px] bg-surface-2",
        "after:absolute after:inset-0 after:-translate-x-full after:animate-shimmer",
        "after:bg-gradient-to-r after:from-transparent after:via-[var(--skeleton-shimmer)] after:to-transparent",
        className,
      )}
      {...props}
    />
  )
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-1">
      <div className="flex h-9 items-center gap-4 border-b border-border bg-surface-2 px-4">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-2.5 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex h-12 items-center gap-4 border-b border-border px-4 last:border-0">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className={cn("h-3", c === 0 ? "flex-[1.6]" : "flex-1")} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function MetricSkeleton() {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface-1 p-5">
      <Skeleton className="h-2.5 w-20" />
      <Skeleton className="h-7 w-28" />
      <Skeleton className="h-2.5 w-24" />
    </div>
  )
}
