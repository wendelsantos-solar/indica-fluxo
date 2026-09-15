import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"
import { OnboardingStepper } from "@/features/onboarding/onboarding-stepper"
import { ProgramForm, type ProgramFormValues } from "@/features/programs/program-form"
import { requireUser } from "@/server/auth/session"
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
            />
          </div>
        </div>
      </>
    )
  }

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
          <ProgramForm mode="create" workspaceSlug={workspaceSlug} defaultValues={defaultValues} />
        </div>
      </div>
    </>
  )
}
