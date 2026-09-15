import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

import { PageHeader } from "@/components/layout/page-header"
import { AuditLogPanel } from "@/features/plans/audit-log-panel"
import { PlanPanel } from "@/features/plans/plan-panel"
import { upgradeOffer } from "@/features/plans/plan-display"
import { UpgradePrompt } from "@/features/plans/upgrade-prompt"
import { currencyOptions, timezoneOptions } from "@/features/workspaces/options"
import { WorkspaceSettingsForm } from "@/features/workspaces/settings-forms"
import { TeamPanel } from "@/features/workspaces/team-panel"
import { BCP47, type Locale } from "@/i18n/routing"
import { fitsLimit } from "@/lib/plans"
import { requireUser } from "@/server/auth/session"
import { listAuditLog } from "@/server/services/audit"
import { getBillingOverview } from "@/server/services/platform-billing"
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

export default async function SettingsPage({ params, searchParams }: PageProps<"/[locale]/[workspaceSlug]/settings">) {
  const t = await getTranslations("dashboard.settings")
  const tr = await getTranslations("common.roles")
  const te = await getTranslations("errors")
  const locale = BCP47[(await getLocale()) as Locale] ?? "pt-BR"
  const { workspaceSlug } = await params
  const { billing: billingParam } = await searchParams
  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)

  const canManage = workspace.role === "owner" || workspace.role === "admin"

  const [team, overview, billing] = await Promise.all([
    getTeam(user, workspace.id),
    getPlanOverview(user.id, workspace.id),
    getBillingOverview(user.id, workspace.id),
  ])
  const { entitlements, usage } = overview
  const auditAvailable = entitlements.capabilities.features.auditLog
  const auditEntries = canManage && auditAvailable ? await listAuditLog(user.id, workspace.id) : []

  // The team panel replaces its invite form with the reason it is closed, so
  // the founder learns about the plan before filling anything in.
  const membersFull = !fitsLimit(entitlements.capabilities.limits.members, usage.members)
  const inviteDisabledReason = !entitlements.canCreate
    ? te("plan.subscriptionRequired")
    : membersFull
      ? te("plan.limit.members")
      : undefined
  const membersOffer =
    entitlements.canCreate && membersFull
      ? upgradeOffer("members", { currentPlan: entitlements.subscribedPlan, needed: usage.members + 1 })
      : null

  const billingReturn = billingParam === "success" || billingParam === "cancelled" ? billingParam : undefined

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
            <PlanPanel
              workspaceSlug={workspace.slug}
              workspaceId={workspace.id}
              billing={billing}
              overview={overview}
              billingReturn={billingReturn}
              timeZone={workspace.timezone}
            />
          </div>

          <div id="equipe" className="scroll-mt-20">
            <TeamPanel
              workspaceId={workspace.id}
              team={team}
              inviteDisabledReason={inviteDisabledReason}
              inviteDisabledNotice={
                membersOffer ? (
                  <UpgradePrompt
                    reason="members"
                    workspaceSlug={workspace.slug}
                    currentPlan={entitlements.subscribedPlan}
                    needed={usage.members + 1}
                    message={te("plan.limit.members")}
                  />
                ) : undefined
              }
            />
          </div>

          {canManage ? (
            <div id="auditoria" className="scroll-mt-20">
              <AuditLogPanel
                available={auditAvailable}
                subscribedPlan={entitlements.subscribedPlan}
                workspaceSlug={workspace.slug}
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
