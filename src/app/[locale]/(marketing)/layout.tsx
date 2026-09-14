import { getTranslations } from "next-intl/server"

import { Link } from "@/i18n/navigation"

import { Logo } from "@/components/layout/logo"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { Button } from "@/components/ui/button"
import { LocaleSwitcher } from "@/components/layout/locale-switcher"

export default async function MarketingLayout({ children }: LayoutProps<"/[locale]">) {
  const t = await getTranslations("marketing.chrome")

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-[2px]">
        <div className="mx-auto flex h-14 w-full max-w-page items-center gap-6 px-4 sm:px-6">
          <Link href="/" aria-label={t("home")}>
            <Logo />
          </Link>
          <nav aria-label={t("navLabel")} className="hidden items-center gap-1 sm:flex">
            <Link
              href="/pricing"
              className="rounded-control px-2.5 py-1.5 text-caption text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("pricing")}
            </Link>
            <Link
              href="/docs"
              className="rounded-control px-2.5 py-1.5 text-caption text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("docs")}
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <LocaleSwitcher />
            <ThemeToggle />
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">{t("signIn")}</Link>
            </Button>
            <Button asChild variant="primary" size="sm">
              <Link href="/signup">{t("startFree")}</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-page flex-wrap items-center justify-between gap-4 px-4 py-8 sm:px-6">
          <Logo />
          <p className="text-meta text-muted-foreground">{t("footer")}</p>
        </div>
      </footer>
    </div>
  )
}
