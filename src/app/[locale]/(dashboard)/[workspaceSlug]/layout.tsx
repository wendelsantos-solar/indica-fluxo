import { NextIntlClientProvider } from "next-intl"
import { notFound } from "next/navigation"

import { DashboardShell } from "@/components/layout/dashboard-shell"
import { WorkspaceTimeZone } from "@/components/layout/workspace-time-zone"
import { billingBannerKind } from "@/features/billing/billing-banner"
import { clientMessages } from "@/i18n/client-messages"
import { BillingStatusBanner } from "@/features/billing/billing-status-banner"
import { resolveTimeZone } from "@/lib/time-zone"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { userHasParticipation } from "@/server/repositories/affiliates"
import { getViewEnvironment, getWorkspaceStanding } from "@/server/services/view-environment"
import { getWorkspaceForUser, listUserWorkspaces } from "@/server/services/workspaces"

export const dynamic = "force-dynamic"

export default async function DashboardLayout({
  children,
  params,
}: LayoutProps<"/[locale]/[workspaceSlug]">) {
  const { workspaceSlug } = await params
  const user = await requireUser()

  // Independent reads go out together, each on its own pooled connection. The
  // account menu only offers the affiliate portal to someone who has one.
  const [workspaces, isAffiliate] = await Promise.all([
    listUserWorkspaces(user.id),
    withUser(user.id, (tx) => userHasParticipation(tx, user.id)),
  ])
  const current = workspaces.find((workspace) => workspace.slug === workspaceSlug)
  if (!current) notFound()

  // Touch the workspace through the RLS-scoped path so a stale sidebar entry
  // can never keep a revoked member inside the shell. Cached per request: the
  // page asks for the same workspace.
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)

  // The billing banner reads the workspace's standing (docs/PLANS.md §6); live
  // or test — the shell's switch and every page's reads — resolves from the
  // same cached read.
  const [{ entitlements }, environment] = await Promise.all([
    getWorkspaceStanding(user.id, workspace.id),
    getViewEnvironment(user.id, workspace.id),
  ])

  // Dates inside a workspace are its calendar facts: every client component
  // below formats in the workspace's zone, like the pages do on the server.
  return (
    <NextIntlClientProvider messages={await clientMessages("app")}>
      <WorkspaceTimeZone timeZone={resolveTimeZone(workspace.timezone)}>
        <DashboardShell
          workspaces={workspaces}
          current={current}
          email={user.email}
          name={user.name}
          isAffiliate={isAffiliate}
          environment={environment}
          notice={
            billingBannerKind(entitlements) ? (
              <div className="px-4 pt-4 md:px-6">
                <BillingStatusBanner
                  workspaceSlug={workspace.slug}
                  standing={entitlements.standing}
                  subscribedPlan={entitlements.subscribedPlan}
                  graceEndsAt={entitlements.graceEndsAt}
                  endsAt={entitlements.endsAt}
                  canManage={workspace.role !== "member"}
                  className="mx-auto max-w-content"
                />
              </div>
            ) : null
          }
        >
          {children}
        </DashboardShell>
      </WorkspaceTimeZone>
    </NextIntlClientProvider>
  )
}
