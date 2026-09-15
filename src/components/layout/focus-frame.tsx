import type * as React from "react"

import { LocaleSwitcher } from "@/components/layout/locale-switcher"
import { Logo } from "@/components/layout/logo"
import { ThemeToggle } from "@/components/layout/theme-toggle"

/**
 * The frame of a guided flow — onboarding's workspace and program steps. The
 * brand, the page's own actions and the reader's preferences in a slim bar,
 * then the same inset content panel as the app, without the sidebar, the
 * palette or anything else to wander off to.
 *
 * It mirrors `AppShell`'s panel (the scroll container on `md` and up, the
 * phone bar at 48px), so a `PageHeader` inside sticks exactly as it does in
 * the product and the two steps of the flow look like one screen.
 */
export function FocusFrame({
  actions,
  skipLabel,
  children,
}: {
  /** Page-level exits, e.g. "Voltar ao painel". Rendered before the preferences. */
  actions?: React.ReactNode
  skipLabel: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background md:h-dvh md:overflow-hidden">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-skip focus:rounded-control focus:bg-inverse focus:px-3 focus:py-2 focus:text-inverse-foreground"
      >
        {skipLabel}
      </a>
      <header className="sticky top-0 z-header flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-4 pt-[env(safe-area-inset-top)] md:static md:border-0 md:px-4">
        <Logo />
        <div className="flex items-center gap-1">
          {actions}
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>

      <main id="main" className="min-w-0 flex-1 md:min-h-0 md:px-2 md:pb-2">
        <div
          id="main-scroll"
          data-slot="scrollable"
          className="relative min-h-[calc(100dvh-3rem)] bg-surface-1 pb-[env(safe-area-inset-bottom)] md:h-full md:min-h-0 md:overflow-y-auto md:rounded-panel md:border md:border-border"
        >
          <div className="px-4 pb-16 md:px-6 [&>*:not([data-page-header])]:mx-auto [&>*:not([data-page-header])]:max-w-content">
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
