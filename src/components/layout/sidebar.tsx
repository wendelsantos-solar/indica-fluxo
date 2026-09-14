"use client"

import {
  BarChart3,
  Coins,
  CreditCard,
  Layers,
  Menu,
  Plug,
  Receipt,
  Settings,
  Users,
  X,
} from "lucide-react"
import { Link } from "@/i18n/navigation"
import { useTranslations } from "next-intl"

import { usePathname } from "@/i18n/navigation"
import * as React from "react"

import { WorkspaceSwitcher, type WorkspaceOption } from "@/components/layout/workspace-switcher"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Canonical pathnames, not URL segments. `Link` translates them per locale, so
 * `/[workspaceSlug]/commissions` renders as `/pt-br/acme/comissoes` without this
 * file knowing either the locale or its spelling.
 */
const NAV = [
  { pathname: "/[workspaceSlug]/overview", key: "overview", icon: BarChart3 },
  { pathname: "/[workspaceSlug]/programs", key: "programs", icon: Layers },
  { pathname: "/[workspaceSlug]/affiliates", key: "affiliates", icon: Users },
  { pathname: "/[workspaceSlug]/conversions", key: "conversions", icon: Receipt },
  { pathname: "/[workspaceSlug]/commissions", key: "commissions", icon: Coins },
  { pathname: "/[workspaceSlug]/payouts", key: "payouts", icon: CreditCard },
  { pathname: "/[workspaceSlug]/integrations", key: "integrations", icon: Plug },
  { pathname: "/[workspaceSlug]/settings", key: "settings", icon: Settings },
] as const

export function Sidebar({
  workspaces,
  current,
}: {
  workspaces: WorkspaceOption[]
  current: WorkspaceOption
}) {
  const t = useTranslations("nav")
  const pathname = usePathname()
  const [open, setOpen] = React.useState(false)
  const [lastPathname, setLastPathname] = React.useState(pathname)

  // Close the mobile sheet whenever the route changes. Done as a render-phase
  // update rather than in an effect, which would cause a cascading render.
  if (pathname !== lastPathname) {
    setLastPathname(pathname)
    setOpen(false)
  }

  const nav = (
    <nav aria-label={t("main")} className="flex-1 space-y-0.5 px-2 py-2">
      {NAV.map((item) => {
        // `usePathname` from @/i18n/navigation returns the canonical path with
        // the locale stripped, so it compares against the template directly.
        const href = item.pathname.replace("[workspaceSlug]", current.slug)
        const active = pathname === href || pathname.startsWith(`${href}/`)
        return (
          <Link
            key={item.key}
            href={{ pathname: item.pathname, params: { workspaceSlug: current.slug } }}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-control px-2 py-1.5 text-caption",
              "transition-colors duration-[120ms]",
              active
                ? "bg-surface-2 font-medium text-foreground"
                : "text-muted-foreground hover:bg-surface-2 hover:text-foreground-secondary",
            )}
          >
            <item.icon className="size-4 shrink-0" aria-hidden="true" />
            {t(item.key)}
          </Link>
        )
      })}
    </nav>
  )

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 md:hidden">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setOpen(true)}
          aria-label={t("open")}
        >
          <Menu aria-hidden="true" />
        </Button>
        <span className="text-caption font-medium">{current.name}</span>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-[var(--scrim)]"
            aria-label={t("close")}
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-[260px] flex-col border-r border-border bg-surface-1">
            <div className="flex items-center justify-between border-b border-border p-2">
              <WorkspaceSwitcher workspaces={workspaces} current={current} />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setOpen(false)}
                aria-label={t("close")}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
            {nav}
          </div>
        </div>
      ) : null}

      <aside className="hidden w-[240px] shrink-0 flex-col border-r border-border bg-surface-1 md:flex">
        <div className="border-b border-border p-2">
          <WorkspaceSwitcher workspaces={workspaces} current={current} />
        </div>
        {nav}
      </aside>
    </>
  )
}
