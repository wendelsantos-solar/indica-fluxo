import { ArrowLeft } from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

import { LocaleSwitcher } from "@/components/layout/locale-switcher"
import { Logo } from "@/components/layout/logo"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { Button } from "@/components/ui/button"
import { OnboardingStepper } from "@/features/onboarding/onboarding-stepper"
import { CreateWorkspaceForm } from "@/features/workspaces/create-workspace-form"
import { CURRENCIES } from "@/features/workspaces/options"
import { Link } from "@/i18n/navigation"
import { BCP47, DEFAULT_CURRENCY, type Locale } from "@/i18n/routing"
import { requireUser } from "@/server/auth/session"
import { listUserWorkspaces } from "@/server/services/workspaces"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/onboarding">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "onboarding" })
  return { title: t("title") }
}

export default async function OnboardingPage() {
  const locale = (await getLocale()) as Locale
  const t = await getTranslations("onboarding")
  const user = await requireUser()

  // A founder who already has a workspace can still create another one (the
  // workspace switcher links here), but must never be stranded on this screen.
  const workspaces = await listUserWorkspaces(user.id)
  const existing = workspaces[0] ?? null

  const currencyNames = new Intl.DisplayNames([BCP47[locale]], { type: "currency" })
  const currencies = CURRENCIES.map((currency) => ({
    code: currency.code,
    label: currencyNames.of(currency.code) ?? currency.label,
  }))

  // The same bare-canvas frame as sign-in and sign-up: onboarding is the
  // last step of that flow, not the first screen of the product.
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-14 items-center justify-between gap-2 px-4 sm:px-6">
        <Logo />
        <div className="flex items-center gap-1">
          {existing ? (
            <Button asChild variant="ghost" size="sm" className="mr-1">
              <Link
                href={{
                  pathname: "/[workspaceSlug]/overview",
                  params: { workspaceSlug: existing.slug },
                }}
              >
                <ArrowLeft aria-hidden="true" />
                {t("backToDashboard")}
              </Link>
            </Button>
          ) : null}
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-1 justify-center px-4 pb-16 pt-8 sm:items-center sm:py-16">
        <div className="w-full max-w-md">
          <OnboardingStepper current="workspace" className="mb-8" />

          <div className="mb-6 space-y-1.5">
            <h1 className="text-balance text-subheading text-foreground">{t("title")}</h1>
            <p className="text-pretty text-caption text-muted-foreground">{t("description")}</p>
          </div>

          <CreateWorkspaceForm defaultCurrency={DEFAULT_CURRENCY[locale]} currencies={currencies} />
        </div>
      </main>
    </div>
  )
}
