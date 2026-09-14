import { notFound } from "next/navigation"

import { Sidebar } from "@/components/layout/sidebar"
import { TopBar } from "@/components/layout/top-bar"
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
    <div className="flex min-h-dvh bg-background">
      <Sidebar workspaces={workspaces} current={current} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar email={user.email} />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>
      </div>
    </div>
  )
}
