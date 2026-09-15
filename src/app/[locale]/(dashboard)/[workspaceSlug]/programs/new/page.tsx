import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"
import { OnboardingStepper } from "@/features/onboarding/onboarding-stepper"
import { programAvailability } from "@/features/programs/plan-availability"
import { ProgramForm, type EnvironmentChoice, type ProgramFormValues } from "@/features/programs/program-form"
import { ProgramPlanNotice } from "@/features/programs/program-plan-notice"
import { currencyOptions } from "@/features/workspaces/options"
import { minorToMajor } from "@/lib/money"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listPrograms } from "@/server/repositories/programs"
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
    environment: "test",
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

  // A form that cannot be saved is not offered: when the plan leaves no room
  // for a program in either environment, the page says why and where to change
  // it. `createProgram` enforces the same limits, so a race still ends in the
  // form's translated error.
  const [plan, programs] = await Promise.all([
    getPlanOverview(user.id, workspace.id),
    withUser(user.id, (tx) => listPrograms(tx, workspace.id)),
  ])
  const availability = programAvailability(plan.entitlements, plan.usage)
  const canCreate = availability.test || availability.live

  const environmentChoice: EnvironmentChoice = {
    test: availability.test,
    live: availability.live,
    liveBlockedBy: availability.liveBlockedBy,
    // Going live is a new live program; it can start from a test program's
    // settings (docs/PLANS.md §2).
    templates: programs
      .filter((program) => program.environment === "test")
      .map((program) => ({
        id: program.id,
        name: program.name,
        values: {
          description: program.description ?? "",
          websiteUrl: program.websiteUrl ?? "",
          status: program.status === "archived" ? "active" : program.status,
          commissionType: program.commissionType,
          commissionAmount: String(
            program.commissionType === "percentage"
              ? program.commissionValue / 100
              : minorToMajor(program.commissionValue, program.currency),
          ),
          recurrence:
            program.commissionDurationMonths === null
              ? "lifetime"
              : program.commissionDurationMonths === 1
                ? "first_only"
                : "months",
          durationMonths: String(program.commissionDurationMonths ?? 12),
          attributionModel: program.attributionModel,
          attributionWindowDays: String(program.attributionWindowDays),
          commissionHoldDays: String(program.commissionHoldDays),
          currency: program.currency.trim(),
        },
      })),
  }
  // Test first; live when test is the one that is full.
  const createValues: ProgramFormValues = {
    ...defaultValues,
    environment: availability.test ? "test" : "live",
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
          {canCreate ? (
            <div className="space-y-4">
              <ProgramPlanNotice workspaceSlug={workspaceSlug} availability={availability} />
              <ProgramForm
                mode="create"
                workspaceSlug={workspaceSlug}
                defaultValues={createValues}
                currencyOptions={currencies}
                environmentChoice={environmentChoice}
              />
            </div>
          ) : (
            <ProgramPlanNotice workspaceSlug={workspaceSlug} availability={availability} />
          )}
        </div>
      </div>
    </>
  )
}
