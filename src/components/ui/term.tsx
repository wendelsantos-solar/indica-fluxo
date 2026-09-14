import type * as React from "react"

import { Tooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * A product term that needs a definition — attribution window, first/last
 * click, hold period. Dotted underline as the affordance; the definition opens
 * on hover and on keyboard focus. Use sparingly: only for real jargon.
 */
export function Term({
  children,
  definition,
  className,
}: {
  children: React.ReactNode
  definition: string
  className?: string
}) {
  return (
    <Tooltip content={definition}>
      <span
        tabIndex={0}
        className={cn(
          "cursor-help underline decoration-border-strong decoration-dotted underline-offset-4 outline-none",
          "focus-visible:rounded-hairline focus-visible:outline-2 focus-visible:outline-ring",
          className,
        )}
      >
        {children}
      </span>
    </Tooltip>
  )
}
