import type { Metadata } from "next"

import { PageHeader } from "@/components/layout/page-header"
import { ProgramForm } from "@/features/programs/program-form"
import { requireUser } from "@/server/auth/session"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const metadata: Metadata = { title: "New program" }
export const dynamic = "force-dynamic"

export default async function NewProgramPage({
  params,
}: PageProps<"/[workspaceSlug]/programs/new">) {
  const { workspaceSlug } = await params
  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New program"
        description="Set the commission rule once — every conversion is calculated against it from then on."
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
