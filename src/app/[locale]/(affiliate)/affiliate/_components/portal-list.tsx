import type * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The portal's one list pattern (DESIGN.md §13: affiliate lists are always
 * stacked, never a sideways scroll). Pages render a table from `md` and this
 * below it — or this at every width when the rows carry more than a table cell
 * can hold, such as a link with its copy button.
 */
export function PortalList({ className, ...props }: React.HTMLAttributes<HTMLUListElement>) {
  return (
    <ul className={cn("divide-y divide-border-faint border-y border-border", className)} {...props} />
  )
}

/**
 * Line 1: what the row is, its status, and the amount on the right.
 * Line 2: the details a reader needs to trust the number (date, base, rate).
 * Anything richer — a URL and its copy button — goes in `children`.
 */
export function PortalListItem({
  title,
  status,
  amount,
  amountClassName,
  details,
  children,
  className,
}: {
  title: React.ReactNode
  status?: React.ReactNode
  amount?: React.ReactNode
  amountClassName?: string
  details?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <li className={cn("px-1 py-3", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 truncate text-ui text-foreground">{title}</div>
          {status ? <div className="shrink-0">{status}</div> : null}
        </div>
        {amount !== undefined ? (
          <div
            className={cn(
              "shrink-0 whitespace-nowrap text-right text-ui font-medium tabular-nums text-foreground",
              amountClassName,
            )}
          >
            {amount}
          </div>
        ) : null}
      </div>
      {details ? (
        <div className="mt-0.5 text-pretty text-meta text-muted-foreground">{details}</div>
      ) : null}
      {children ? <div className="mt-2">{children}</div> : null}
    </li>
  )
}

/** Joins the non-empty parts of a details line with a middle dot. */
export function joinDetails(parts: Array<string | null | undefined | false>): string {
  return parts.filter(Boolean).join(" · ")
}
