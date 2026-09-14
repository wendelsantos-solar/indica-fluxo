import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { LocaleSwitcher } from "@/components/layout/locale-switcher"
import { Logo } from "@/components/layout/logo"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { CreateWorkspaceForm } from "@/features/workspaces/create-workspace-form"
import { requireUser } from "@/server/auth/session"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/onboarding">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "onboarding" })
  return { title: t("title") }
}

export default async function OnboardingPage() {
  const t = await getTranslations("onboarding")
  await requireUser()

  // The same bare-canvas frame as sign-in and sign-up: onboarding is the
  // last step of that flow, not the first screen of the product.
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-14 items-center justify-between px-4 sm:px-6">
        <Logo />
        <div className="flex items-center gap-1">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12 sm:py-16">
        <div className="w-full max-w-md">
          <div className="mb-8 space-y-2 text-center">
            <p className="text-meta tabular-nums text-faint-foreground">{t("step")}</p>
            <h1 className="text-balance text-subheading text-foreground">{t("title")}</h1>
            <p className="text-pretty text-ui text-muted-foreground">{t("description")}</p>
          </div>

          <CreateWorkspaceForm />
        </div>
      </main>
    </div>
  )
}
