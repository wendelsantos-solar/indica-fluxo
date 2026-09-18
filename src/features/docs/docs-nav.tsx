"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

import { useActiveHeading } from "./use-active-heading"

export interface DocsNavGroup {
  key: string
  label: string
  items: {
    id: string
    label: string
    /** Set when the item lives on another page (the beta guide, or back to the guide). */
    href?: string
    /** A short status after the label ("Beta"). */
    badge?: string
  }[]
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
  const ids = React.useMemo(
    () => groups.flatMap((group) => group.items.filter((item) => !item.href).map((item) => item.id)),
    [groups],
  )
  const active = useActiveHeading(ids)

  return (
    <nav aria-label={label} className="space-y-8 text-caption">
      {groups.map((group) => (
        <div key={group.key}>
          <p className="mb-2 pl-3 text-meta font-medium text-foreground">{group.label}</p>
          <ul className="border-l border-border-faint">
            {group.items.map((item) => {
              const current = !item.href && item.id === active
              return (
                <li key={item.id}>
                  <a
                    href={item.href ?? `#${item.id}`}
                    onClick={onNavigate}
                    aria-current={current ? "location" : undefined}
                    className={cn(
                      "group -ml-px flex min-h-8 items-center gap-2 border-l py-1 pl-3 pr-2 transition-colors duration-[120ms] touch:min-h-10",
                      current
                        ? "border-foreground font-medium text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span>{item.label}</span>
                    {item.badge ? (
                      <span className="ml-auto shrink-0 rounded-badge border border-border px-1.5 text-micro font-normal text-muted-foreground">
                        {item.badge}
                      </span>
                    ) : null}
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

export interface DocsTocGroup {
  key: string
  label: string
  items: { id: string; label: string; children?: { id: string; label: string }[] }[]
}

/**
 * "On this page", scoped to where the reader is (brief §47): the sections of
 * the sidebar group being read, and the sub-parts of the active section only.
 * A one-page guide with thirty headings keeps a right rail of six or seven —
 * never the whole outline at once.
 */
export function DocsToc({ title, groups }: { title: string; groups: DocsTocGroup[] }) {
  const ids = React.useMemo(
    () => groups.flatMap((group) => group.items.flatMap((item) => [item.id, ...(item.children ?? []).map((child) => child.id)])),
    [groups],
  )
  const active = useActiveHeading(ids)

  const { group, section } = locate(groups, active)

  if (!group) return null

  return (
    <nav aria-label={title} className="text-meta">
      <p className="mb-1 pl-3 font-medium text-foreground">{title}</p>
      <p className="mb-3 pl-3 text-faint-foreground">{group.label}</p>
      <ul className="border-l border-border-faint">
        {group.items.map((item, index) => {
          const current = item.id === active
          const open = item.id === section && (item.children?.length ?? 0) > 0
          return (
            <li key={item.id} className={cn(index > 0 && "mt-1.5")}>
              <TocLink id={item.id} current={current} tone={open ? "parent" : "section"}>
                {item.label}
              </TocLink>
              {open ? (
                <ul className="mt-1 space-y-0.5">
                  {item.children!.map((child) => (
                    <li key={child.id}>
                      <TocLink id={child.id} current={child.id === active} tone="sub">
                        {child.label}
                      </TocLink>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** The group and the section that hold the active heading; the first group before any is active. */
function locate(groups: DocsTocGroup[], active: string | null): { group: DocsTocGroup | undefined; section: string | null } {
  for (const candidate of groups) {
    for (const item of candidate.items) {
      if (item.id === active || item.children?.some((child) => child.id === active)) return { group: candidate, section: item.id }
    }
  }
  return { group: groups[0], section: null }
}

function TocLink({
  id,
  current,
  tone,
  children,
}: {
  id: string
  current: boolean
  tone: "section" | "parent" | "sub"
  children: React.ReactNode
}) {
  return (
    <a
      href={`#${id}`}
      aria-current={current ? "location" : undefined}
      className={cn(
        "relative block pr-2 leading-snug transition-colors duration-[120ms]",
        "before:absolute before:inset-y-0.5 before:-left-px before:w-0.5 before:rounded-full before:transition-colors",
        tone === "sub" ? "py-0.5 pl-6" : "py-1 pl-3",
        current
          ? "font-medium text-foreground before:bg-foreground"
          : cn(
              "before:bg-transparent hover:text-foreground",
              tone === "parent" ? "text-foreground" : tone === "sub" ? "text-faint-foreground" : "text-foreground-secondary",
            ),
      )}
    >
      {children}
    </a>
  )
}
