import { ChevronLeft, ChevronRight } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * List footer: a summary on the left ("51–100 de 240"), previous/next on the
 * right. The caller passes typed `Link` elements so filters stay in the URL;
 * a missing link renders a disabled button, never a dead anchor.
 */
export function Pagination({
  label,
  summary,
  previous,
  next,
  previousLabel,
  nextLabel,
  className,
}: {
  /** Accessible name of the navigation landmark. */
  label: string
  summary: React.ReactNode
  previous: LinkElement | null
  next: LinkElement | null
  previousLabel: string
  nextLabel: string
  className?: string
}) {
  return (
    <nav
      aria-label={label}
      className={cn("flex min-h-12 items-center justify-between gap-3 text-meta text-muted-foreground", className)}
    >
      <span className="tabular-nums">{summary}</span>
      <span className="flex gap-2">
        {previous ? (
          <Button asChild variant="secondary" size="sm">
            {withIcon(previous, <ChevronLeft aria-hidden="true" />, previousLabel, "start")}
          </Button>
        ) : (
          <Button variant="secondary" size="sm" disabled>
            <ChevronLeft aria-hidden="true" />
            {previousLabel}
          </Button>
        )}
        {next ? (
          <Button asChild variant="secondary" size="sm">
            {withIcon(next, <ChevronRight aria-hidden="true" />, nextLabel, "end")}
          </Button>
        ) : (
          <Button variant="secondary" size="sm" disabled>
            {nextLabel}
            <ChevronRight aria-hidden="true" />
          </Button>
        )}
      </span>
    </nav>
  )
}

type LinkElement = React.ReactElement<{ children?: React.ReactNode }>

function withIcon(link: LinkElement, icon: React.ReactNode, text: string, side: "start" | "end") {
  return React.cloneElement(link, undefined, ...(side === "start" ? [icon, text] : [text, icon]))
}
