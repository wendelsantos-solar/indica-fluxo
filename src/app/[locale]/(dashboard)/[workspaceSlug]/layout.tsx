import { notFound } from "next/navigation"

import { DashboardShell } from "@/components/layout/dashboard-shell"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listParticipationsForUser } from "@/server/repositories/affiliates"
import { getWorkspaceForUser, listUserWorkspaces } from "@/server/services/workspaces"

export const dynamic = "force-dynamic"

export default async function DashboardLayout({
  children,
  params,
}: LayoutProps<"/[locale]/[workspaceSlug]">) {
  const { workspaceSlug } = await params
  const user = await requireUser()

  const workspaces = await listUserWorkspaces(user.id)
  const current = workspaces.find((workspace) => workspace.slug === workspaceSlug)
  if (!current) notFound()

  // Touch the workspace through the RLS-scoped path so a stale sidebar entry
  // can never keep a revoked member inside the shell.
  await getWorkspaceForUser(user.id, workspaceSlug)

  // The account menu only offers the affiliate portal to someone who has one.
  const participations = await withUser(user.id, (tx) => listParticipationsForUser(tx, user.id))

  return (
    <DashboardShell
      workspaces={workspaces}
      current={current}
      email={user.email}
      isAffiliate={participations.length > 0}
    >
      {children}
    </DashboardShell>
  )
}
