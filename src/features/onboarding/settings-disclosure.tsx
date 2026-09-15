"use client"

import { ChevronRight } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Progressive disclosure for settings that have sensible defaults: a button
 * row naming the group and echoing the values it currently holds, over a
 * panel of fields.
 *
 * The panel is hidden with the `hidden` attribute rather than unmounted, so
 * the fields inside keep submitting their values while collapsed — the server
 * action still receives every field its schema expects.
 *
 * `forceOpen` lets a form reveal the group when a field inside it failed
 * validation; an error the reader cannot see is not an error message.
 */
export function SettingsDisclosure({
  title,
  summary,
  defaultOpen = false,
  forceOpen = false,
  framed = true,
  children,
  className,
}: {
  title: string
  summary: string
  defaultOpen?: boolean
  forceOpen?: boolean
  /** A bordered box inside a form; unframed sits flush in a card section. */
  framed?: boolean
  children: React.ReactNode
  className?: string
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  const expanded = open || forceOpen
  const panelId = React.useId()

  return (
    <div className={cn(framed && "rounded-control border border-border", className)}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setOpen(!expanded)}
        className={cn(
          "flex w-full min-w-0 items-start gap-2 text-left sm:items-center",
          "transition-colors duration-[120ms] hover:bg-hover",
          framed ? "rounded-control px-3 py-2 touch:min-h-11" : "px-4 py-3",
        )}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "mt-1 size-3.5 shrink-0 text-muted-foreground transition-transform duration-[120ms] sm:mt-0",
            expanded && "rotate-90",
          )}
        />
        {/* Stacked on phones so the summary wraps instead of being cut off. */}
        <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-2">
          <span className="shrink-0 text-caption font-medium text-foreground">{title}</span>
          <span className="min-w-0 text-meta text-muted-foreground sm:truncate">{summary}</span>
        </span>
      </button>

      <div
        id={panelId}
        hidden={!expanded}
        className={cn(framed ? "space-y-4 border-t border-border p-3" : "px-4 pb-4")}
      >
        {children}
      </div>
    </div>
  )
}
