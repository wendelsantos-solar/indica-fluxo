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
import Link from "next/link"
import { usePathname } from "next/navigation"
import * as React from "react"

import { WorkspaceSwitcher, type WorkspaceOption } from "@/components/layout/workspace-switcher"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const NAV = [
  { href: "overview", label: "Overview", icon: BarChart3 },
  { href: "programs", label: "Programs", icon: Layers },
  { href: "affiliates", label: "Affiliates", icon: Users },
  { href: "conversions", label: "Conversions", icon: Receipt },
  { href: "commissions", label: "Commissions", icon: Coins },
  { href: "payouts", label: "Payouts", icon: CreditCard },
  { href: "integrations", label: "Integrations", icon: Plug },
  { href: "settings", label: "Settings", icon: Settings },
] as const

export function Sidebar({
  workspaces,
  current,
}: {
  workspaces: WorkspaceOption[]
  current: WorkspaceOption
}) {
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
    <nav aria-label="Main" className="flex-1 space-y-0.5 px-2 py-2">
      {NAV.map((item) => {
        const href = `/${current.slug}/${item.href}`
        const active = pathname === href || pathname.startsWith(`${href}/`)
        return (
          <Link
            key={item.href}
            href={href}
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
            {item.label}
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
          aria-label="Open navigation"
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
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-[260px] flex-col border-r border-border bg-surface-1">
            <div className="flex items-center justify-between border-b border-border p-2">
              <WorkspaceSwitcher workspaces={workspaces} current={current} />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
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
