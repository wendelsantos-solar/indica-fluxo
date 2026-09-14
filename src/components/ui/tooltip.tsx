"use client"

import * as Primitive from "@radix-ui/react-tooltip"
import * as React from "react"

import { cn } from "@/lib/utils"

export const TooltipProvider = Primitive.Provider

export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: React.ReactNode
  children: React.ReactNode
  side?: "top" | "right" | "bottom" | "left"
}) {
  return (
    <Primitive.Root delayDuration={200}>
      <Primitive.Trigger asChild>{children}</Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            "z-50 rounded-[6px] border border-border bg-surface-3 px-2 py-1 text-[12px]",
            "text-foreground-secondary shadow-[var(--shadow-overlay)]",
            "data-[state=delayed-open]:animate-[popover-in_140ms_var(--ease-out-quint)]",
          )}
        >
          {content}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  )
}
