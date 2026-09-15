"use client"

import { Menu, X } from "lucide-react"
import { useTranslations } from "next-intl"
import * as React from "react"

import { Link } from "@/i18n/navigation"

import { LocaleSwitcher } from "@/components/layout/locale-switcher"
import { Logo } from "@/components/layout/logo"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { Button } from "@/components/ui/button"

import { DocsSidebarNav, type DocsNavGroup } from "./docs-nav"

/**
 * The docs bar: brand / Docs, then the way into the product. No search box —
 * search does not exist yet, and a box that finds nothing is worse than none.
 * Below `lg` it owns the section drawer (the sidebar is hidden there).
 */
export function DocsHeader({ groups }: { groups: DocsNavGroup[] }) {
  const t = useTranslations("docs")
  const [open, setOpen] = React.useState(false)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const buttonRef = React.useRef<HTMLButtonElement>(null)

  // Modal drawer: focus in, Tab contained, Escape closes, focus returns.
  React.useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    const button = buttonRef.current
    const focusable = () => [...(panel?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])") ?? [])]
    focusable()[0]?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") return setOpen(false)
      if (event.key !== "Tab") return
      const items = focusable()
      const first = items[0]
      const last = items.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", onKeyDown)
    return () => {
      document.body.style.overflow = overflow
      window.removeEventListener("keydown", onKeyDown)
      button?.focus()
    }
  }, [open])

  return (
    <>
      <header className="sticky top-0 z-header border-b border-border bg-background/95 backdrop-blur-[2px]">
        <div className="mx-auto flex h-14 w-full max-w-docs items-center gap-3 px-4 sm:px-6">
          <button
            ref={buttonRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-label={t("header.openMenu")}
            aria-expanded={open}
            className="-ml-2 flex size-10 items-center justify-center rounded-control text-muted-foreground hover:bg-hover hover:text-foreground lg:hidden"
          >
            <Menu className="size-4.5" aria-hidden="true" />
          </button>
          <div className="flex min-w-0 items-center gap-2.5">
            <Link href="/" className="rounded-control">
              <Logo />
            </Link>
            <span aria-hidden="true" className="text-faint-foreground">
              /
            </span>
            <Link href="/docs" className="rounded-control text-caption font-medium text-foreground">
              {t("header.docs")}
            </Link>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <div className="hidden items-center gap-1 sm:flex">
              <LocaleSwitcher />
              <ThemeToggle />
            </div>
            <Button asChild variant="ghost" size="sm" className="ml-1 hidden sm:inline-flex">
              <Link href="/app">{t("header.dashboard")}</Link>
            </Button>
            <Button asChild variant="primary" size="sm" className="ml-1">
              <Link href="/signup">{t("header.signUp")}</Link>
            </Button>
          </div>
        </div>
      </header>

      {open ? (
        <div className="fixed inset-0 z-drawer lg:hidden" role="dialog" aria-modal="true" aria-label={t("nav.label")}>
          <button
            type="button"
            tabIndex={-1}
            aria-label={t("header.closeMenu")}
            className="absolute inset-0 animate-[overlay-in_140ms_ease-out] bg-scrim"
            onClick={() => setOpen(false)}
          />
          <div
            ref={panelRef}
            className="absolute inset-y-0 left-0 flex w-80 max-w-[85vw] animate-fade-in flex-col border-r border-border bg-background"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
              <span className="text-caption font-medium text-foreground">{t("nav.label")}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("header.closeMenu")}
                className="-mr-2 flex size-10 items-center justify-center rounded-control text-muted-foreground hover:bg-hover hover:text-foreground"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div data-slot="scrollable" className="flex-1 overflow-y-auto px-2 py-4">
              <DocsSidebarNav groups={groups} label={t("nav.label")} onNavigate={() => setOpen(false)} />
            </div>
            <div className="flex items-center gap-1 border-t border-border px-4 py-3 sm:hidden">
              <LocaleSwitcher />
              <ThemeToggle />
              <Button asChild variant="secondary" size="sm" className="ml-auto">
                <Link href="/app">{t("header.dashboard")}</Link>
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
