import type * as React from "react"

import { cn } from "@/lib/utils"

/**
 * "Stable" / "Beta" beside a provider's name in the guide. Beta is a status,
 * not decoration: always a word, never a colour alone (brief §40).
 */
export function StatusPill({ tone, children }: { tone: "stable" | "beta"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-badge border px-1.5 text-micro font-normal",
        tone === "stable" ? "border-border text-muted-foreground" : "border-warning/40 text-warning-foreground",
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", tone === "stable" ? "bg-success" : "bg-warning")} />
      {children}
    </span>
  )
}
