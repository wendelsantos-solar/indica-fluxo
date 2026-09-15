import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

import { PageHeader, SectionHeader } from "@/components/layout/page-header"
import { Badge } from "@/components/ui/badge"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { currencyOptions, timezoneOptions } from "@/features/workspaces/options"
import { InviteMemberForm, WorkspaceSettingsForm } from "@/features/workspaces/settings-forms"
import { getFormatters } from "@/i18n/format"
import { BCP47, type Locale } from "@/i18n/routing"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listMembers, listPendingInvites } from "@/server/repositories/workspaces"
import { getWorkspaceForUser } from "@/server/services/workspaces"

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
  const tc = await getTranslations("common.table")
  const tr = await getTranslations("common.roles")
  const f = await getFormatters()
  const locale = BCP47[(await getLocale()) as Locale] ?? "pt-BR"
  const { workspaceSlug } = await params
  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)

  const [members, invites] = await withUser(user.id, (tx) =>
    Promise.all([listMembers(tx, workspace.id), listPendingInvites(tx, workspace.id)]),
  )

  const canManage = workspace.role === "owner" || workspace.role === "admin"

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

          <section>
            <SectionHeader
              title={t("team.title")}
              count={f.number(members.length + invites.length)}
              description={t("team.description")}
              className="mb-3"
            />

            <TableContainer>
              <Table>
                <THead>
                  <tr>
                    <TH>{t("team.member")}</TH>
                    <TH>{t("team.role")}</TH>
                    <TH className="max-sm:hidden">{tc("joined")}</TH>
                  </tr>
                </THead>
                <TBody>
                  {members.map((member) => (
                    <TR key={member.id}>
                      <TD className="max-sm:py-2.5">
                        <span className="block truncate text-foreground">
                          {member.fullName ?? t("team.pendingProfile")}
                          {member.userId === user.id ? (
                            <span className="ml-2 text-meta text-muted-foreground">{t("team.you")}</span>
                          ) : null}
                        </span>
                        {member.fullName ? null : (
                          // The member read carries no e-mail; a short account
                          // id keeps two unnamed members apart.
                          <span className="block text-meta text-muted-foreground">
                            {t("team.pendingProfileHint")}{" "}
                            <span className="font-mono">{member.userId.slice(0, 8)}</span>
                          </span>
                        )}
                        <span className="block text-meta text-muted-foreground sm:hidden">
                          {t("team.joinedOn", { date: f.date(member.createdAt) })}
                        </span>
                      </TD>
                      <TD>
                        <Badge dot={false}>{tr(member.role)}</Badge>
                      </TD>
                      <TD className="whitespace-nowrap text-muted-foreground max-sm:hidden">
                        {f.date(member.createdAt)}
                      </TD>
                    </TR>
                  ))}
                  {invites.map((invite) => (
                    <TR key={invite.id}>
                      <TD className="max-w-0 max-sm:py-2.5 sm:max-w-none">
                        <span className="block truncate text-foreground-secondary">{invite.email}</span>
                        <span className="block text-meta text-muted-foreground">
                          {t("team.invitedOn", { date: f.date(invite.createdAt) })}
                        </span>
                      </TD>
                      <TD>
                        <Badge tone="warning">{t("team.invitedRole", { role: tr(invite.role) })}</Badge>
                      </TD>
                      <TD className="whitespace-nowrap text-muted-foreground max-sm:hidden">—</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>

            {canManage ? (
              <div className="pt-4">
                <InviteMemberForm workspaceId={workspace.id} />
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </>
  )
}
