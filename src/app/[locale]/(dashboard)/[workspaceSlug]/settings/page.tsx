import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

import { PageHeader } from "@/components/layout/page-header"
import { AuditLogPanel } from "@/features/plans/audit-log-panel"
import { PlanPanel } from "@/features/plans/plan-panel"
import { currencyOptions, timezoneOptions } from "@/features/workspaces/options"
import { WorkspaceSettingsForm } from "@/features/workspaces/settings-forms"
import { TeamPanel } from "@/features/workspaces/team-panel"
import { BCP47, type Locale } from "@/i18n/routing"
import { fitsPlan, hasPlanFeature } from "@/lib/plans"
import { requireUser } from "@/server/auth/session"
import { listAuditLog } from "@/server/services/audit"
import { getPlanOverview } from "@/server/services/plans"
import { getTeam, getWorkspaceForUser } from "@/server/services/workspaces"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/[workspaceSlug]/settings">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.settings" })
  return { title: t("title") }
}

export default async function SettingsPage({ params }: PageProps<"/[locale]/[workspaceSlug]/settings">) {
  const t = await getTranslations("dashboard.settings")
  const tr = await getTranslations("common.roles")
  const te = await getTranslations("errors")
  const locale = BCP47[(await getLocale()) as Locale] ?? "pt-BR"
  const { workspaceSlug } = await params
  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)

  const canManage = workspace.role === "owner" || workspace.role === "admin"

  const [team, overview] = await Promise.all([
    getTeam(user, workspace.id),
    getPlanOverview(user.id, workspace.id),
  ])
  const auditEntries =
    canManage && hasPlanFeature(overview.plan, "auditLog") ? await listAuditLog(user.id, workspace.id) : []

  // The team panel replaces its invite form with the reason it is closed, so
  // the founder learns about the plan before filling anything in.
  const inviteDisabledReason = !hasPlanFeature(overview.plan, "teamInvites")
    ? te("planFeature.teamInvites")
    : !fitsPlan(overview.plan, "members", overview.usage.members)
      ? te("planLimit.members")
      : undefined

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />

      {/* The shell caps direct children at the content width; settings read
          better narrower, left-aligned with the description above. */}
      <div>
        <div className="max-w-detail space-y-10">
          <WorkspaceSettingsForm
            workspaceId={workspace.id}
            defaultValues={{
              name: workspace.name,
              defaultCurrency: workspace.defaultCurrency,
              timezone: workspace.timezone,
            }}
            currencies={currencyOptions(locale)}
            timezones={timezoneOptions(locale)}
            disabledReason={canManage ? undefined : t("readOnly", { role: tr(workspace.role) })}
          />

          <div id="plano" className="scroll-mt-20">
            <PlanPanel overview={overview} workspaceId={workspace.id} canManage={canManage} />
          </div>

          <div id="equipe" className="scroll-mt-20">
            <TeamPanel workspaceId={workspace.id} team={team} inviteDisabledReason={inviteDisabledReason} />
          </div>

          {canManage ? (
            <div id="auditoria" className="scroll-mt-20">
              <AuditLogPanel
                plan={overview.plan}
                entries={auditEntries}
                currentUserId={user.id}
                timeZone={workspace.timezone}
              />
            </div>
          ) : null}
        </div>
      </div>
    </>
  )
}
