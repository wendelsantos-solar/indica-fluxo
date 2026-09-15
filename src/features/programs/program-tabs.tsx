"use client"

import * as React from "react"

import { TabLink } from "@/components/ui/tabs"
import { useRouter } from "@/i18n/navigation"
import { cn } from "@/lib/utils"

export const PROGRAM_TABS = ["affiliates", "commissions", "settings"] as const
export type ProgramTab = (typeof PROGRAM_TABS)[number]

/**
 * A program's tab strip. The page renders only the active tab's data, so a tab
 * change is a server round trip; changing `?tab=` does not trigger the route's
 * `loading.tsx`. The navigation therefore runs in a transition: the clicked tab
 * becomes active at once and the current panel dims (`aria-busy`) until the
 * new one arrives, instead of nothing happening for a second.
 *
 * Each tab stays a real link, so a modified or middle click opens a new tab.
 */
export function ProgramTabs({
  workspaceSlug,
  programSlug,
  active,
  label,
  tabs,
  children,
}: {
  workspaceSlug: string
  programSlug: string
  active: ProgramTab
  /** Accessible name of the tab navigation. */
  label: string
  tabs: { value: ProgramTab; label: string; count?: string }[]
  children: React.ReactNode
}) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [current, setCurrent] = React.useOptimistic(active)

  const hrefFor = (value: ProgramTab) =>
    ({
      pathname: "/[workspaceSlug]/programs/[programSlug]",
      params: { workspaceSlug, programSlug },
      query: { tab: value },
    }) as const

  return (
    <div className="space-y-6">
      <nav
        className="-mx-4 flex items-center gap-5 overflow-x-auto border-b border-border px-4 md:mx-0 md:px-0"
        aria-label={label}
      >
        {tabs.map((tab) => (
          <TabLink
            key={tab.value}
            href={hrefFor(tab.value)}
            active={current === tab.value}
            className="shrink-0"
            onClick={(event) => {
              if (event.defaultPrevented || event.button !== 0) return
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
              event.preventDefault()
              if (tab.value === current) return
              startTransition(() => {
                setCurrent(tab.value)
                router.push(hrefFor(tab.value), { scroll: false })
              })
            }}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span className="font-normal tabular-nums text-muted-foreground">{tab.count}</span>
            ) : null}
          </TabLink>
        ))}
      </nav>

      <div
        aria-busy={pending || undefined}
        className={cn("transition-opacity duration-[120ms]", pending && "pointer-events-none opacity-50")}
      >
        {children}
      </div>
    </div>
  )
}
