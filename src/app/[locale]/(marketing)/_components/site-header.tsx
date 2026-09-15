"use client"

import { Menu, X } from "lucide-react"
import { useTranslations } from "next-intl"
import * as React from "react"

import { Link } from "@/i18n/navigation"

import { LocaleSwitcher } from "@/components/layout/locale-switcher"
import { Logo } from "@/components/layout/logo"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const NAV_LINK =
  "whitespace-nowrap rounded-control px-2.5 py-1.5 text-caption text-muted-foreground transition-colors duration-[120ms] hover:text-foreground"

/**
 * The public navbar. Transparent over the hero; once the page scrolls it takes
 * the canvas colour and a hairline, so it separates from content without glass
 * or blur. Below `lg` the links move into a disclosure panel — sign-in stays
 * reachable on a phone. This is the one client leaf on the landing: it needs
 * the scroll position and the menu state, nothing else.
 */
export function SiteHeader() {
  const t = useTranslations("marketing.chrome")
  const [scrolled, setScrolled] = React.useState(false)
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  React.useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  const links = [
    { href: { pathname: "/" as const, hash: "produto" }, label: t("product") },
    { href: { pathname: "/" as const, hash: "como-funciona" }, label: t("howItWorks") },
    { href: "/pricing" as const, label: t("pricing") },
    { href: "/docs" as const, label: t("docs") },
  ]

  return (
    <header
      className={cn(
        "sticky top-0 z-header border-b transition-colors duration-200",
        scrolled || open ? "border-border bg-background" : "border-transparent bg-background/0",
      )}
    >
      <div className="mx-auto flex h-14 w-full max-w-page items-center gap-6 px-4 sm:px-6">
        <Link href="/" aria-label={t("home")} className="rounded-control" onClick={() => setOpen(false)}>
          <Logo />
        </Link>

        <nav aria-label={t("navLabel")} className="hidden items-center gap-0.5 lg:flex">
          {links.map((link) => (
            <Link key={link.label} href={link.href} className={NAV_LINK}>
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <div className="hidden items-center gap-1 sm:flex">
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
          <Button asChild variant="ghost" size="sm" className="ml-1 hidden lg:inline-flex">
            <Link href="/login">{t("signIn")}</Link>
          </Button>
          <Button asChild variant="primary" size="sm" className="ml-1">
            <Link href="/signup">{t("startFree")}</Link>
          </Button>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={t("openMenu")}
            className="-mr-2 ml-1 flex size-10 items-center justify-center rounded-control text-muted-foreground hover:bg-hover hover:text-foreground lg:hidden"
          >
            {open ? <X className="size-4.5" aria-hidden="true" /> : <Menu className="size-4.5" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {open ? (
        <div id="site-menu" className="border-t border-border bg-background lg:hidden">
          <nav aria-label={t("navLabel")} className="mx-auto flex max-w-page flex-col px-4 py-2 sm:px-6">
            {links.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                onClick={() => setOpen(false)}
                className="flex h-11 items-center border-b border-border-faint text-ui text-foreground-secondary last:border-0"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="mx-auto flex max-w-page items-center gap-2 border-t border-border px-4 py-3 sm:px-6">
            <Button asChild variant="secondary" className="h-10 flex-1">
              <Link href="/login" onClick={() => setOpen(false)}>
                {t("signIn")}
              </Link>
            </Button>
            <div className="flex items-center gap-1 sm:hidden">
              <LocaleSwitcher />
              <ThemeToggle />
            </div>
          </div>
        </div>
      ) : null}
    </header>
  )
}
