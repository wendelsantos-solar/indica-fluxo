import { notFound } from "next/navigation"

import { DashboardShell } from "@/components/layout/dashboard-shell"
import { requireUser } from "@/server/auth/session"
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

  return (
    <DashboardShell workspaces={workspaces} current={current} email={user.email}>
      {children}
    </DashboardShell>
  )
}
