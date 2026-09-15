import * as React from "react"

import { cn } from "@/lib/utils"

/** Keyboard key hint. Only rendered for a shortcut that actually works. */
export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-hairline border border-border bg-surface-2 px-1",
        "font-sans text-label leading-none text-muted-foreground touch:hidden",
        className,
      )}
      {...props}
    />
  )
}
