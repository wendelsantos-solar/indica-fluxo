import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { PageHeader } from "@/components/layout/page-header"
import { Link } from "@/i18n/navigation"
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
  const tp = await getTranslations("dashboard.programs")
  const { workspaceSlug } = await params
  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)

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
      </div>
    </>
  )
}
