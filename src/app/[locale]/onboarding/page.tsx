import { ArrowLeft } from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"
import { cookies } from "next/headers"

import { FocusFrame } from "@/components/layout/focus-frame"
import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { OnboardingStepper } from "@/features/onboarding/onboarding-stepper"
import { CreateWorkspaceForm } from "@/features/workspaces/create-workspace-form"
import { currencyOptions, timezoneOptions } from "@/features/workspaces/options"
import { Link } from "@/i18n/navigation"
import { BCP47, DEFAULT_CURRENCY, type Locale } from "@/i18n/routing"
import { LAST_WORKSPACE_COOKIE, pickReturnWorkspace } from "@/lib/last-workspace"
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

/**
 * Step 1 of onboarding. It shares one frame with step 2 (the program form,
 * which the dashboard shell renders in the same `FocusFrame`): bar, panel,
 * header, stepper, one narrow column — so the flow reads as one screen that
 * advances, not a bare page followed by the full product.
 */
export default async function OnboardingPage() {
  const locale = (await getLocale()) as Locale
  const t = await getTranslations("onboarding")
  const tn = await getTranslations("nav")
  const user = await requireUser()

  // A founder who already has a workspace can still create another one (the
  // workspace switcher links here), but must never be stranded on this screen:
  // the way back is the workspace they came from.
  const workspaces = await listUserWorkspaces(user.id)
  const remembered = (await cookies()).get(LAST_WORKSPACE_COOKIE)?.value
  const back = pickReturnWorkspace(workspaces, remembered)

  const bcp47 = BCP47[locale]

  return (
    <FocusFrame
      skipLabel={tn("skip")}
      actions={
        back ? (
          <Button asChild variant="ghost" size="sm" className="mr-1">
            <Link href={{ pathname: "/[workspaceSlug]/overview", params: { workspaceSlug: back.slug } }}>
              <ArrowLeft aria-hidden="true" />
              {t("backToDashboard")}
            </Link>
          </Button>
        ) : null
      }
    >
      <PageHeader title={t("header")} />
      <div>
        <div className="mx-auto max-w-md pb-12 md:pt-4">
          <OnboardingStepper current="workspace" className="mb-8" />

          <div className="mb-6 space-y-1.5">
            <h2 className="text-balance text-subheading text-foreground">{t("title")}</h2>
            <p className="text-pretty text-caption text-muted-foreground">{t("description")}</p>
          </div>

          <CreateWorkspaceForm
            defaultCurrency={DEFAULT_CURRENCY[locale]}
            currencies={currencyOptions(bcp47)}
            timezones={timezoneOptions(bcp47)}
          />
        </div>
      </div>
    </FocusFrame>
  )
}
