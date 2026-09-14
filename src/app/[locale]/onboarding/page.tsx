import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

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

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex items-center justify-between px-6 py-4">
        <Logo />
        <ThemeToggle />
      </header>

      <main className="mx-auto flex w-full max-w-[460px] flex-1 flex-col justify-center px-4 py-10">
        <div className="mb-6 space-y-2">
          <p className="text-meta font-medium uppercase tracking-[0.02em] text-muted-foreground">
            {t("step")}
          </p>
          <h1 className="text-subheading font-medium">{t("title")}</h1>
          <p className="text-caption leading-relaxed text-muted-foreground">
            {t("description")}
          </p>
        </div>

        <CreateWorkspaceForm />
      </main>
    </div>
  )
}
