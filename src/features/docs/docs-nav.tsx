"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

import { useActiveHeading } from "./use-active-heading"

export interface DocsNavGroup {
  key: string
  label: string
  items: { id: string; label: string; step?: number }[]
}

/**
 * The docs sidebar: groups of sections, sticky, scrolling on its own. The
 * active item gets a hairline marker and foreground text — no coloured fill.
 */
export function DocsSidebarNav({
  groups,
  label,
  onNavigate,
}: {
  groups: DocsNavGroup[]
  label: string
  onNavigate?: () => void
}) {
  const ids = React.useMemo(() => groups.flatMap((group) => group.items.map((item) => item.id)), [groups])
  const active = useActiveHeading(ids)

  return (
    <nav aria-label={label} className="space-y-6 text-caption">
      {groups.map((group) => (
        <div key={group.key}>
          <p className="mb-1.5 px-3 text-meta font-medium text-foreground">{group.label}</p>
          <ul className="border-l border-border-faint">
            {group.items.map((item) => {
              const current = item.id === active
              return (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    onClick={onNavigate}
                    aria-current={current ? "location" : undefined}
                    className={cn(
                      "-ml-px flex min-h-8 items-center gap-2 border-l py-1 pl-3 pr-2 transition-colors duration-[120ms] touch:min-h-10",
                      current
                        ? "border-foreground font-medium text-foreground"
                        : "border-transparent text-muted-foreground hover:border-border-strong hover:text-foreground",
                    )}
                  >
                    {item.step ? (
                      <span className="w-4 shrink-0 font-mono text-meta text-faint-foreground" aria-hidden="true">
                        {item.step}
                      </span>
                    ) : null}
                    <span>{item.label}</span>
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

/** "On this page": the outline with nested subsections, following the scroll. */
export function DocsToc({
  title,
  items,
}: {
  title: string
  items: { id: string; label: string; depth: 2 | 3 }[]
}) {
  const ids = React.useMemo(() => items.map((item) => item.id), [items])
  const active = useActiveHeading(ids)

  return (
    <nav aria-label={title} className="text-meta">
      <p className="mb-2 font-medium text-foreground">{title}</p>
      <ul className="space-y-0.5 border-l border-border-faint">
        {items.map((item) => {
          const current = item.id === active
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={current ? "location" : undefined}
                className={cn(
                  "-ml-px block border-l py-1 pr-2 leading-snug transition-colors duration-[120ms]",
                  item.depth === 3 ? "pl-6" : "pl-3",
                  current
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
