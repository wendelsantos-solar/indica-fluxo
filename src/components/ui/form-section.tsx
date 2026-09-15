import type * as React from "react"

import { cn } from "@/lib/utils"

/**
 * One group of related fields inside a form card: heading and one-line
 * description on the left, fields on the right from `md`, separated from the
 * previous group by a hairline. DESIGN.md §9 Forms.
 *
 * The hairline sits on top of every section but the first of its form, so a
 * footer with its own `border-t` after the last section never draws two lines.
 */
export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        "grid gap-4 border-t border-border px-4 py-5 first-of-type:border-t-0 md:grid-cols-[minmax(0,14rem)_1fr] md:gap-8 sm:px-5",
        className,
      )}
    >
      <div>
        <h2 className="text-caption font-medium text-foreground">{title}</h2>
        {description ? <p className="mt-1 text-pretty text-meta text-muted-foreground">{description}</p> : null}
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  )
}
