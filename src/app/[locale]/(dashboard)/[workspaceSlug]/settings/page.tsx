import type { Metadata } from "next"

import { PageHeader } from "@/components/layout/page-header"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { InviteMemberForm, WorkspaceSettingsForm } from "@/features/workspaces/settings-forms"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listMembers, listPendingInvites } from "@/server/repositories/workspaces"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const metadata: Metadata = { title: "Settings" }
export const dynamic = "force-dynamic"

export default async function SettingsPage({ params }: PageProps<"/[locale]/[workspaceSlug]/settings">) {
  const { workspaceSlug } = await params
  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)

  const [members, invites] = await withUser(user.id, (tx) =>
    Promise.all([listMembers(tx, workspace.id), listPendingInvites(tx, workspace.id)]),
  )

  const canManage = workspace.role === "owner" || workspace.role === "admin"

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" description="Workspace details and team access." />

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
              <CardTitle>Team</CardTitle>
              <CardDescription>
                Members see everything in this workspace. Only owners and admins can change
                programs, payouts and keys.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <TableContainer>
              <Table>
                <THead>
                  <tr>
                    <TH>Member</TH>
                    <TH>Role</TH>
                    <TH>Joined</TH>
                  </tr>
                </THead>
                <TBody>
                  {members.map((member) => (
                    <TR key={member.id}>
                      <TD className="text-foreground">
                        {member.fullName ?? "Pending profile"}
                        {member.userId === user.id ? (
                          <span className="ml-2 text-label text-muted-foreground">(you)</span>
                        ) : null}
                      </TD>
                      <TD>
                        <Badge tone={member.role === "owner" ? "primary" : "neutral"}>
                          {member.role}
                        </Badge>
                      </TD>
                      <TD className="text-muted-foreground">
                        {member.createdAt.toISOString().slice(0, 10)}
                      </TD>
                    </TR>
                  ))}
                  {invites.map((invite) => (
                    <TR key={invite.id}>
                      <TD className="text-muted-foreground">{invite.email}</TD>
                      <TD>
                        <Badge tone="warning">invited · {invite.role}</Badge>
                      </TD>
                      <TD className="text-muted-foreground">
                        {invite.createdAt.toISOString().slice(0, 10)}
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
