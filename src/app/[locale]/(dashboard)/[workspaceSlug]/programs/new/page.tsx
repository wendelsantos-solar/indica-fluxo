import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

import { InlineAlert } from "@/components/feedback/inline-alert"
import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"
import { OnboardingStepper } from "@/features/onboarding/onboarding-stepper"
import { ProgramForm, type ProgramFormValues } from "@/features/programs/program-form"
import { currencyOptions } from "@/features/workspaces/options"
import { requireUser } from "@/server/auth/session"
import { getPlanOverview } from "@/server/services/plans"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/[workspaceSlug]/programs/new">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.newProgram" })
  return { title: t("title") }
}

export default async function NewProgramPage({
  params,
  searchParams,
}: PageProps<"/[locale]/[workspaceSlug]/programs/new">) {
  const t = await getTranslations("dashboard.newProgram")
  const tp = await getTranslations("dashboard.programs")
  const { workspaceSlug } = await params
  const { onboarding } = await searchParams
  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)
  const locale = await getLocale()
  // Built here, not in the client form, so `Intl` names match at hydration.
  const currencies = currencyOptions(locale)

  const defaultValues: ProgramFormValues = {
    name: "",
    description: "",
    websiteUrl: "",
    status: "active",
    commissionType: "percentage",
    commissionAmount: "30",
    recurrence: "months",
    durationMonths: "12",
    attributionModel: "last_click",
    attributionWindowDays: "60",
    commissionHoldDays: "30",
    currency: workspace.defaultCurrency,
  }

  if (onboarding === "1") {
    return (
      <>
        <PageHeader
          title={t("onboarding.header")}
          actions={
            // Safe to skip: the overview's checklist keeps "Set up the
            // program" pending and links straight back here.
            <Button asChild variant="ghost" size="sm">
              <Link href={{ pathname: "/[workspaceSlug]/overview", params: { workspaceSlug } }}>
                {t("onboarding.skip")}
              </Link>
            </Button>
          }
        />
        <div>
          <div className="mx-auto max-w-md pb-12 md:pt-4">
            <OnboardingStepper current="program" className="mb-8" />

            <div className="mb-6 space-y-1.5">
              <h2 className="text-balance text-subheading text-foreground">
                {t("onboarding.title")}
              </h2>
              <p className="text-pretty text-caption text-muted-foreground">
                {t("onboarding.description")}
              </p>
            </div>

            <ProgramForm
              mode="create"
              variant="onboarding"
              workspaceSlug={workspaceSlug}
              defaultValues={defaultValues}
              currencyOptions={currencies}
            />
          </div>
        </div>
      </>
    )
  }

  // A form that cannot be saved is not offered: past the plan's program limit
  // the page says why and where to change it. `createProgram` enforces the
  // same limit, so a race still ends in the form's translated error.
  const plan = await getPlanOverview(user.id, workspace.id)
  const programLimit = plan.limits.programs
  const atProgramLimit = programLimit !== null && plan.usage.programs >= programLimit

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        breadcrumb={[
          <Link
            key="programs"
            href={{ pathname: "/[workspaceSlug]/programs", params: { workspaceSlug } }}
          >
            {tp("title")}
          </Link>,
        ]}
      />
      {/* The shell caps direct children at the content width; the form reads
          better narrower, left-aligned with the description above it. */}
      <div>
        <div className="max-w-detail">
          {atProgramLimit && programLimit !== null ? (
            <InlineAlert
              title={tp("planLimit.title", { limit: programLimit })}
              action={
                <Button asChild variant="secondary" size="sm">
                  <Link href={{ pathname: "/[workspaceSlug]/settings", params: { workspaceSlug } }}>
                    {tp("planLimit.action")}
                  </Link>
                </Button>
              }
            >
              {tp("planLimit.description")}
            </InlineAlert>
          ) : (
            <ProgramForm
              mode="create"
              workspaceSlug={workspaceSlug}
              defaultValues={defaultValues}
              currencyOptions={currencies}
            />
          )}
        </div>
      </div>
    </>
  )
}
