import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react"
import type * as React from "react"

import { TH } from "@/components/ui/table"
import { Link } from "@/i18n/navigation"
import { cn } from "@/lib/utils"

type Href = React.ComponentProps<typeof Link>["href"]

/**
 * A column header that sorts the list through the URL (`?sort=&dir=`), so the
 * order survives reloads, shared links and works without JavaScript. DESIGN.md
 * §9 Table: the sorted column sets `aria-sort` and shows a 14px chevron; the
 * others reveal a quiet affordance on hover or focus.
 *
 * The caller computes `href` (with `nextSort()` from `lib/list-params`) because
 * only the page knows its pathname and the filters that must be kept.
 */
export function SortableHeader({
  children,
  href,
  sorted,
  numeric,
  className,
}: {
  children: React.ReactNode
  href: Href
  /** The direction when this column is the active sort, otherwise false. */
  sorted: "asc" | "desc" | false
  numeric?: boolean
  className?: string
}) {
  const Icon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ChevronsUpDown

  return (
    <TH
      numeric={numeric}
      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
      className={className}
    >
      <Link
        href={href}
        scroll={false}
        className={cn(
          "group/sort -mx-1 inline-flex items-center gap-1 rounded-badge px-1 transition-colors duration-[120ms]",
          "hover:text-foreground focus-visible:text-foreground",
          sorted ? "text-foreground" : undefined,
          numeric && "flex-row-reverse",
        )}
      >
        <span>{children}</span>
        <Icon
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0",
            sorted
              ? "text-muted-foreground"
              : "text-faint-foreground opacity-0 group-hover/sort:opacity-100 group-focus-visible/sort:opacity-100",
          )}
        />
      </Link>
    </TH>
  )
}
