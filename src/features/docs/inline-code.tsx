import type * as React from "react"

import { cn } from "@/lib/utils"

/** Code inside prose: reads as code without shouting. */
export function InlineCode({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <code
      className={cn(
        "whitespace-nowrap rounded-badge border border-border-faint bg-fill px-1 py-px font-mono text-caption text-foreground",
        className,
      )}
    >
      {children}
    </code>
  )
}
