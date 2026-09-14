import { getTranslations } from "next-intl/server"

import { Link } from "@/i18n/navigation"

import { ThemeToggle } from "@/components/layout/theme-toggle"
import { Logo } from "@/components/layout/logo"
import { LocaleSwitcher } from "@/components/layout/locale-switcher"

export default async function AuthLayout({ children }: LayoutProps<"/[locale]">) {
  const t = await getTranslations("marketing.chrome")

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2" aria-label={t("home")}>
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[380px]">{children}</div>
      </main>
      <footer className="px-6 py-6 text-center text-meta text-muted-foreground">
        {t("tagline")}
      </footer>
    </div>
  )
}
