import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { PageHeader } from "@/components/layout/page-header"
import { ProgramForm } from "@/features/programs/program-form"
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
}: PageProps<"/[locale]/[workspaceSlug]/programs/new">) {
  const t = await getTranslations("dashboard.newProgram")
  const { workspaceSlug } = await params
  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t("title")}
        description={t("description")}
      />
      <ProgramForm
        mode="create"
        workspaceSlug={workspaceSlug}
        defaultValues={{
          name: "",
          description: "",
          status: "active",
          commissionType: "percentage",
          commissionAmount: "30",
          recurrence: "months",
          durationMonths: "12",
          attributionModel: "last_click",
          attributionWindowDays: "60",
          commissionHoldDays: "30",
          currency: workspace.defaultCurrency,
        }}
      />
    </div>
  )
}
