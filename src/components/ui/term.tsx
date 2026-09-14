"use client"

import * as React from "react"

import { Tooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * A product term that needs a definition — attribution window, first/last
 * click, hold period. Dotted underline as the affordance; the definition opens
 * on hover and keyboard focus, and on tap for touch screens (Radix tooltips
 * ignore taps, so the open state is controlled here). Tapping again or
 * anywhere else closes it. Use sparingly: only for real jargon.
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
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLSpanElement>(null)

  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [open])

  return (
    <Tooltip content={definition} open={open} onOpenChange={setOpen}>
      <span
        ref={ref}
        tabIndex={0}
        role="button"
        aria-expanded={open}
        // Radix closes a tooltip on pointerdown over its trigger; keep that
        // from racing the tap toggle below.
        onPointerDown={(event) => {
          if (event.pointerType !== "mouse") event.preventDefault()
        }}
        onClick={(event) => {
          if ((event.nativeEvent as PointerEvent).pointerType !== "mouse") setOpen((value) => !value)
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            setOpen((value) => !value)
          }
        }}
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
