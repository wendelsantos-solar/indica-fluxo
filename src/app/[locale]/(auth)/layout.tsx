import { getTranslations, setRequestLocale } from "next-intl/server"

import { Link } from "@/i18n/navigation"

import { LocaleSwitcher } from "@/components/layout/locale-switcher"
import { Logo } from "@/components/layout/logo"
import { ThemeToggle } from "@/components/layout/theme-toggle"

/**
 * Sign-in and sign-up sit on the bare canvas: a thin top bar, one narrow
 * centred column, and nothing that competes with the form's submit button.
 */
export default async function AuthLayout({ children, params }: LayoutProps<"/[locale]">) {
  // Without this the layout's `getTranslations` call opts the whole subtree
  // out of static rendering, and every marketing page becomes a server render.
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations("marketing.chrome")

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-14 items-center justify-between px-4 sm:px-6">
        <Link href="/" className="rounded-control" aria-label={t("home")}>
          <Logo />
        </Link>
        <div className="flex items-center gap-1">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-12 sm:py-16">
        <div className="w-full max-w-sm">{children}</div>
      </main>
      <footer className="px-4 py-6 text-center text-meta text-faint-foreground sm:px-6">
        {t("tagline")}
      </footer>
    </div>
  )
}
