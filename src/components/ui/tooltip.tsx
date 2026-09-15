"use client"

import * as Primitive from "@radix-ui/react-tooltip"
import * as React from "react"

import { cn } from "@/lib/utils"

export const TooltipProvider = Primitive.Provider

export function Tooltip({
  content,
  children,
  side = "top",
  open,
  onOpenChange,
}: {
  content: React.ReactNode
  children: React.ReactNode
  side?: "top" | "right" | "bottom" | "left"
  /** Controlled state, for triggers that also open on tap (see `Term`). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <Primitive.Root delayDuration={200} open={open} onOpenChange={onOpenChange}>
      <Primitive.Trigger asChild>{children}</Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            "z-popover max-w-[280px] rounded-control bg-surface-3 px-2 py-1 text-meta",
            "text-foreground-secondary shadow-overlay",
            "data-[state=delayed-open]:animate-pop-in",
          )}
        >
          {content}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  )
}
