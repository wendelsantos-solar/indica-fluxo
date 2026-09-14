import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { getFormatters } from "@/i18n/format"
import { PageHeader } from "@/components/layout/page-header"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { InviteMemberForm, WorkspaceSettingsForm } from "@/features/workspaces/settings-forms"
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
  const { workspaceSlug } = await params
  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)

  const [members, invites] = await withUser(user.id, (tx) =>
    Promise.all([listMembers(tx, workspace.id), listPendingInvites(tx, workspace.id)]),
  )

  const canManage = workspace.role === "owner" || workspace.role === "admin"

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("title")} description={t("description")} />

      <div className="space-y-6">
        <WorkspaceSettingsForm
          workspaceId={workspace.id}
          defaultValues={{
            name: workspace.name,
            defaultCurrency: workspace.defaultCurrency,
            timezone: workspace.timezone,
          }}
          disabled={!canManage}
        />

        <Card>
          <CardHeader bordered>
            <div>
              <CardTitle>{t("team.title")}</CardTitle>
              <CardDescription>{t("team.description")}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <TableContainer>
              <Table>
                <THead>
                  <tr>
                    <TH>{t("team.member")}</TH>
                    <TH>{t("team.role")}</TH>
                    <TH>{tc("joined")}</TH>
                  </tr>
                </THead>
                <TBody>
                  {members.map((member) => (
                    <TR key={member.id}>
                      <TD className="text-foreground">
                        {member.fullName ?? t("team.pendingProfile")}
                        {member.userId === user.id ? (
                          <span className="ml-2 text-label text-muted-foreground">{t("team.you")}</span>
                        ) : null}
                      </TD>
                      <TD>
                        <Badge tone={member.role === "owner" ? "primary" : "neutral"}>
                          {tr(member.role)}
                        </Badge>
                      </TD>
                      <TD className="text-muted-foreground">
                        {f.date(member.createdAt)}
                      </TD>
                    </TR>
                  ))}
                  {invites.map((invite) => (
                    <TR key={invite.id}>
                      <TD className="text-muted-foreground">{invite.email}</TD>
                      <TD>
                        <Badge tone="warning">{t("team.invitedRole", { role: tr(invite.role) })}</Badge>
                      </TD>
                      <TD className="text-muted-foreground">
                        {f.date(invite.createdAt)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>

            {canManage ? <InviteMemberForm workspaceId={workspace.id} /> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
