import { Compass } from "lucide-react"
import { useTranslations } from "next-intl"

import { Link } from "@/i18n/navigation"

import { Logo } from "@/components/layout/logo"
import { Button } from "@/components/ui/button"

/** The localised 404, on the same bare canvas as auth and onboarding. */
export default function NotFound() {
  const t = useTranslations("notFound")

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-14 items-center px-4 sm:px-6">
        <Link href="/" className="rounded-control">
          <Logo />
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-24">
        <div className="flex max-w-sm flex-col items-center text-center">
          <div className="mb-4 flex size-10 items-center justify-center rounded-panel border border-border bg-surface-1 text-muted-foreground">
            <Compass className="size-4.5" aria-hidden="true" />
          </div>
          <p className="font-mono text-meta text-faint-foreground">404</p>
          <h1 className="mt-2 text-title text-foreground">{t("title")}</h1>
          <p className="mt-2 text-pretty text-caption text-muted-foreground">{t("description")}</p>
          <div className="mt-6 flex gap-2">
            <Button asChild variant="primary">
              <Link href="/app">{t("dashboard")}</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/">{t("home")}</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  )
}
