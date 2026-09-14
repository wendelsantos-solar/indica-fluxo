import { useTranslations } from "next-intl"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The sticky bar at the top of the content panel, plus the page's one-line
 * description beneath it — DESIGN.md §11. Title (or a breadcrumb ending in the
 * title) on the left, the page's actions on the right.
 *
 * The bar is full-bleed across the panel and must be a direct child of the
 * shell's content column, or `position: sticky` has nothing to stick within;
 * that is why the description is a sibling rather than a wrapper.
 */
export function PageHeader({
  title,
  description,
  actions,
  meta,
  breadcrumb,
  className,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  meta?: React.ReactNode
  /** Parent crumbs, each usually a `Link`. The title is always the last crumb. */
  breadcrumb?: React.ReactNode[]
  className?: string
}) {
  const t = useTranslations("nav")

  return (
    <>
      <div
        data-page-header
        className={cn(
          "sticky top-12 z-20 -mx-4 flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border",
          "bg-surface-1/90 px-4 py-2 backdrop-blur-[2px] md:top-0 md:-mx-6 md:px-6",
          description ? "mb-5" : "mb-6",
          className,
        )}
      >
        {breadcrumb?.length ? (
          <nav aria-label={t("breadcrumb")} className="flex min-w-0 items-center gap-1.5 text-caption">
            {breadcrumb.map((crumb, index) => (
              <React.Fragment key={index}>
                <span className="shrink-0 text-muted-foreground [&_a:hover]:text-foreground [&_a]:transition-colors">
                  {crumb}
                </span>
                <span aria-hidden="true" className="text-faint-foreground">
                  /
                </span>
              </React.Fragment>
            ))}
            <h1 className="truncate font-medium text-foreground">{title}</h1>
          </nav>
        ) : (
          <h1 className="truncate text-caption font-medium text-foreground">{title}</h1>
        )}
        {meta ? (
          <div className="flex min-w-0 items-center gap-2 text-caption tabular-nums text-muted-foreground">
            {meta}
          </div>
        ) : null}
        {actions ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {description ? (
        <p className="mb-6 text-pretty text-caption text-muted-foreground">
          <span className="block max-w-[68ch]">{description}</span>
        </p>
      ) : null}
    </>
  )
}

/** A heading for a block inside a page: title, optional count, one action. */
export function SectionHeader({
  title,
  count,
  action,
  className,
}: {
  title: string
  count?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("mb-1 flex min-h-8 items-center justify-between gap-3", className)}>
      <h2 className="flex items-center gap-2 text-caption font-medium text-foreground">
        {title}
        {count !== undefined ? (
          <span className="font-normal tabular-nums text-muted-foreground">{count}</span>
        ) : null}
      </h2>
      {action}
    </div>
  )
}
