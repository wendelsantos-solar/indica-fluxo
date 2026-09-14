import { getTranslations, setRequestLocale } from "next-intl/server"

import { Link } from "@/i18n/navigation"

import { LocaleSwitcher } from "@/components/layout/locale-switcher"
import { Logo } from "@/components/layout/logo"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { Button } from "@/components/ui/button"

const NAV_LINK =
  "rounded-control px-2 py-1 text-caption text-muted-foreground transition-colors duration-[120ms] hover:text-foreground"

/**
 * The public frame. A solid canvas bar — no blur, no glass — with the one
 * persistent conversion action on the right. The header CTA is the same
 * action as the hero CTA (both go to sign-up), so the two never compete for
 * the reader's choice; everything else in the bar is neutral.
 */
export default async function MarketingLayout({ children, params }: LayoutProps<"/[locale]">) {
  // Without this the layout's `getTranslations` call opts the whole subtree
  // out of static rendering, and every marketing page becomes a server render.
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations("marketing.chrome")

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background">
        <div className="mx-auto flex h-14 w-full max-w-page items-center gap-6 px-4 sm:px-6">
          <Link href="/" aria-label={t("home")} className="rounded-control">
            <Logo />
          </Link>
          <nav aria-label={t("navLabel")} className="hidden items-center gap-2 sm:flex">
            <Link href="/pricing" className={NAV_LINK}>
              {t("pricing")}
            </Link>
            <Link href="/docs" className={NAV_LINK}>
              {t("docs")}
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <LocaleSwitcher />
            <ThemeToggle />
            <Button asChild variant="ghost" size="sm" className="ml-1 hidden sm:inline-flex">
              <Link href="/login">{t("signIn")}</Link>
            </Button>
            <Button asChild variant="primary" size="sm" className="ml-1">
              <Link href="/signup">{t("startFree")}</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-page flex-col gap-8 px-4 py-12 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div className="max-w-sm space-y-3">
            <Logo />
            <p className="text-caption text-muted-foreground">{t("footer")}</p>
          </div>
          {/* Not a second <nav>: two landmarks with one label would be ambiguous. */}
          <div className="-mx-2 flex flex-wrap items-center gap-2">
            <Link href="/pricing" className={NAV_LINK}>
              {t("pricing")}
            </Link>
            <Link href="/docs" className={NAV_LINK}>
              {t("docs")}
            </Link>
            <Link href="/login" className={NAV_LINK}>
              {t("signIn")}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
