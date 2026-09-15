"use client"

import { LogOut, MailPlus, MoreHorizontal, Shield, User, UserMinus, X } from "lucide-react"
import { useTranslations } from "next-intl"
import * as React from "react"
import { useActionState, useRef, useState, useTransition } from "react"

import { SectionHeader } from "@/components/layout/page-header"
import { InlineAlert } from "@/components/feedback/inline-alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
  DropdownTrigger,
} from "@/components/ui/dropdown"
import { Field } from "@/components/ui/field"
import { Input, Select } from "@/components/ui/input"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { useActionResult } from "@/components/ui/use-action-result"
import { useFormatters } from "@/i18n/use-formatters"
import { checkMemberChange, type WorkspaceRole } from "@/server/domain/invites"
import type { PendingInvite, Team, TeamMember } from "@/server/services/workspaces"

import {
  changeMemberRoleAction,
  inviteMemberAction,
  removeMemberAction,
  resendMemberInviteAction,
  revokeInviteAction,
  type FormState,
} from "./actions"
import { InviteOutcome } from "./invite-outcome"

export interface TeamPanelProps {
  workspaceId: string
  /** `getTeam(user, workspace.id)` from `server/services/workspaces`. */
  team: Team
  /**
   * Set when the plan does not include team invitations (or the member limit
   * is reached): shown instead of the invite form, in the reader's language.
   */
  inviteDisabledReason?: string
}

const INITIAL: FormState = {}

const DANGER_ITEM =
  "text-danger-foreground data-[highlighted]:text-danger-foreground [&_svg]:text-danger-foreground"

type DialogState =
  | { kind: "remove"; member: TeamMember }
  | { kind: "revoke"; invite: PendingInvite }
  | { kind: "resend"; invite: PendingInvite }
  | null

/**
 * Settings → Team: who is in the workspace, who is invited, and — for owners
 * and admins — changing roles, removing people, revoking and re-sending
 * invitations, and inviting someone new.
 *
 * Names and addresses are what RLS lets the reader see: their own, and for
 * owners and admins the address a teammate was invited with. Anyone else is
 * "Member", never an internal id.
 */
export function TeamPanel({ workspaceId, team, inviteDisabledReason }: TeamPanelProps) {
  const t = useTranslations("dashboard.settings.team")
  const tc = useTranslations("common.table")
  const roleLabel = useRoleLabels()
  const f = useFormatters()
  const [dialog, setDialog] = useState<DialogState>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const canManage = team.viewerRole !== "member"
  const close = () => setDialog(null)

  // The dialogs have no trigger of their own; give focus back to the menu
  // button they were opened from (DESIGN.md §12).
  const restoreFocus = (event: Event) => {
    event.preventDefault()
    triggerRef.current?.focus()
  }

  return (
    <section>
      <SectionHeader
        title={t("title")}
        count={f.number(team.members.length + team.invites.length)}
        description={t("description")}
        className="mb-3"
      />

      <TableContainer>
        <Table>
          <THead>
            <tr>
              <TH>{t("member")}</TH>
              <TH>{t("role")}</TH>
              <TH className="max-sm:hidden">{tc("joined")}</TH>
              {canManage ? (
                <TH className="w-10">
                  <span className="sr-only">{t("actions")}</span>
                </TH>
              ) : null}
            </tr>
          </THead>
          <TBody>
            {team.members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                team={team}
                workspaceId={workspaceId}
                canManage={canManage}
                onRemove={(trigger) => {
                  triggerRef.current = trigger
                  setDialog({ kind: "remove", member })
                }}
              />
            ))}
            {team.invites.map((invite) => (
              <TR key={invite.id}>
                <TD className="max-w-0 max-sm:py-2.5 sm:max-w-none">
                  <span className="block truncate text-foreground-secondary">{invite.email}</span>
                  <span className="block text-meta text-muted-foreground">
                    {t("invitedOn", { date: f.date(invite.invitedAt) })}
                  </span>
                </TD>
                <TD>
                  <Badge tone="warning">{t("pendingRole", { role: roleLabel(invite.role) })}</Badge>
                </TD>
                <TD className="whitespace-nowrap text-muted-foreground max-sm:hidden">—</TD>
                {canManage ? (
                  <TD className="text-right">
                    <InviteMenu
                      invite={invite}
                      onOpen={(kind, trigger) => {
                        triggerRef.current = trigger
                        setDialog({ kind, invite })
                      }}
                    />
                  </TD>
                ) : null}
              </TR>
            ))}
          </TBody>
        </Table>
      </TableContainer>

      {canManage ? (
        <div className="pt-4">
          {inviteDisabledReason ? (
            <InlineAlert>{inviteDisabledReason}</InlineAlert>
          ) : (
            <InviteMemberForm workspaceId={workspaceId} />
          )}
        </div>
      ) : null}

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && close()}>
        <DialogContent size={dialog?.kind === "resend" ? "form" : undefined} onCloseAutoFocus={restoreFocus}>
          {dialog?.kind === "remove" ? (
            <RemoveMemberForm workspaceId={workspaceId} member={dialog.member} onDone={close} />
          ) : dialog?.kind === "revoke" ? (
            <RevokeInviteForm workspaceId={workspaceId} invite={dialog.invite} onDone={close} />
          ) : dialog?.kind === "resend" ? (
            <ResendInviteForm workspaceId={workspaceId} invite={dialog.invite} onDone={close} />
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  )
}

function useRoleLabels(): (role: WorkspaceRole) => string {
  const tr = useTranslations("common.roles")
  return (role) => tr(role)
}

function memberLabel(member: TeamMember, fallback: string): string {
  return member.name ?? member.email ?? fallback
}

function MemberRow({
  member,
  team,
  workspaceId,
  canManage,
  onRemove,
}: {
  member: TeamMember
  team: Team
  workspaceId: string
  canManage: boolean
  onRemove: (trigger: HTMLButtonElement | null) => void
}) {
  const t = useTranslations("dashboard.settings.team")
  const roleLabel = useRoleLabels()
  const f = useFormatters()
  const trigger = useRef<HTMLButtonElement>(null)
  const [roleState, setRoleState] = useState<FormState>(INITIAL)
  const [pending, startTransition] = useTransition()

  // A role change has no dialog to show its outcome in, so both results toast.
  useActionResult(roleState)

  const label = memberLabel(member, t("unnamedMember"))
  const allowed = (change: Parameters<typeof checkMemberChange>[0]["change"]) =>
    canManage &&
    checkMemberChange({
      actorRole: team.viewerRole,
      targetRole: member.role,
      ownerCount: team.ownerCount,
      change,
    }).ok

  const roleTargets = (["admin", "member"] as const).filter(
    (role) => role !== member.role && allowed({ kind: "role", to: role }),
  )
  const canRemove = allowed({ kind: "remove" })

  const changeRole = (role: "admin" | "member") =>
    startTransition(async () => {
      const formData = new FormData()
      formData.set("workspaceId", workspaceId)
      formData.set("memberId", member.id)
      formData.set("role", role)
      setRoleState(await changeMemberRoleAction(INITIAL, formData))
    })

  return (
    <TR>
      <TD className="max-w-0 max-sm:py-2.5 sm:max-w-none">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-foreground">{label}</span>
          {member.isYou ? <span className="shrink-0 text-meta text-muted-foreground">{t("you")}</span> : null}
        </span>
        {member.name && member.email ? (
          <span className="block truncate text-meta text-muted-foreground">{member.email}</span>
        ) : null}
        <span className="block text-meta text-muted-foreground sm:hidden">
          {t("joinedOn", { date: f.date(member.joinedAt) })}
        </span>
      </TD>
      <TD>
        <Badge dot={false}>{roleLabel(member.role)}</Badge>
      </TD>
      <TD className="whitespace-nowrap text-muted-foreground max-sm:hidden">{f.date(member.joinedAt)}</TD>
      {canManage ? (
        <TD className="text-right">
          {roleTargets.length > 0 || canRemove ? (
            <Dropdown modal={false}>
              <DropdownTrigger asChild ref={trigger}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  loading={pending}
                  aria-label={t("menuLabel", { name: label })}
                >
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              </DropdownTrigger>
              <DropdownContent align="end">
                {roleTargets.map((role) => (
                  <DropdownItem key={role} onSelect={() => changeRole(role)}>
                    {role === "admin" ? <Shield aria-hidden="true" /> : <User aria-hidden="true" />}
                    {role === "admin" ? t("makeAdmin") : t("makeMember")}
                  </DropdownItem>
                ))}
                {roleTargets.length > 0 && canRemove ? <DropdownSeparator /> : null}
                {canRemove ? (
                  <DropdownItem className={DANGER_ITEM} onSelect={() => onRemove(trigger.current)}>
                    {member.isYou ? <LogOut aria-hidden="true" /> : <UserMinus aria-hidden="true" />}
                    {member.isYou ? t("leave") : t("remove")}
                  </DropdownItem>
                ) : null}
              </DropdownContent>
            </Dropdown>
          ) : null}
        </TD>
      ) : null}
    </TR>
  )
}

function InviteMenu({
  invite,
  onOpen,
}: {
  invite: PendingInvite
  onOpen: (kind: "resend" | "revoke", trigger: HTMLButtonElement | null) => void
}) {
  const t = useTranslations("dashboard.settings.team")
  const trigger = useRef<HTMLButtonElement>(null)

  return (
    <Dropdown modal={false}>
      <DropdownTrigger asChild ref={trigger}>
        <Button variant="ghost" size="icon-sm" aria-label={t("menuLabel", { name: invite.email })}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownTrigger>
      <DropdownContent align="end">
        <DropdownItem onSelect={() => onOpen("resend", trigger.current)}>
          <MailPlus aria-hidden="true" />
          {t("resend")}
        </DropdownItem>
        <DropdownSeparator />
        <DropdownItem className={DANGER_ITEM} onSelect={() => onOpen("revoke", trigger.current)}>
          <X aria-hidden="true" />
          {t("revoke")}
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  )
}

/**
 * The confirmation dialogs below are mounted only while open, so every opening
 * starts from a clean action state instead of the previous attempt's error.
 */
function ConfirmForm({
  action,
  pending,
  error,
  title,
  body,
  confirm,
  children,
}: {
  action: (formData: FormData) => void
  pending: boolean
  error?: string
  title: string
  body: string
  confirm: string
  children: React.ReactNode
}) {
  const ta = useTranslations("common.actions")
  return (
    <form action={action} className="flex min-h-0 flex-col">
      {children}
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <DialogDescription className="text-ui text-foreground-secondary">{body}</DialogDescription>
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary" autoFocus disabled={pending}>
            {ta("cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" variant="destructive" loading={pending}>
          {confirm}
        </Button>
      </DialogFooter>
    </form>
  )
}

function RemoveMemberForm({
  workspaceId,
  member,
  onDone,
}: {
  workspaceId: string
  member: TeamMember
  onDone: () => void
}) {
  const t = useTranslations("dashboard.settings.team")
  const [state, action, pending] = useActionState(removeMemberAction, INITIAL)
  useActionResult(state, { onSuccess: onDone, toastOnError: false })

  const name = memberLabel(member, t("unnamedMember"))
  const copy = member.isYou
    ? { title: t("leaveTitle"), body: t("leaveBody"), confirm: t("leaveConfirm") }
    : { title: t("removeTitle", { name }), body: t("removeBody", { name }), confirm: t("removeConfirm") }

  return (
    <ConfirmForm action={action} pending={pending} error={state.error} {...copy}>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="memberId" value={member.id} />
    </ConfirmForm>
  )
}

function RevokeInviteForm({
  workspaceId,
  invite,
  onDone,
}: {
  workspaceId: string
  invite: PendingInvite
  onDone: () => void
}) {
  const t = useTranslations("dashboard.settings.team")
  const [state, action, pending] = useActionState(revokeInviteAction, INITIAL)
  useActionResult(state, { onSuccess: onDone, toastOnError: false })

  return (
    <ConfirmForm
      action={action}
      pending={pending}
      error={state.error}
      title={t("revokeTitle", { email: invite.email })}
      body={t("revokeBody")}
      confirm={t("revokeConfirm")}
    >
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="inviteId" value={invite.id} />
    </ConfirmForm>
  )
}

/** Re-sends, then stays open on the outcome: whether it went out, and the link. */
function ResendInviteForm({
  workspaceId,
  invite,
  onDone,
}: {
  workspaceId: string
  invite: PendingInvite
  onDone: () => void
}) {
  const t = useTranslations("dashboard.settings.team")
  const ta = useTranslations("common.actions")
  const [state, action, pending] = useActionState(resendMemberInviteAction, INITIAL)
  useActionResult(state, { toastOnSuccess: false, toastOnError: false })

  if (state.invite) {
    return (
      <div className="flex min-h-0 flex-col">
        <DialogHeader>
          <DialogTitle>{t("resendTitle")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <InviteOutcome {...state.invite} />
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="primary" onClick={onDone}>
            {t("done")}
          </Button>
        </DialogFooter>
      </div>
    )
  }

  return (
    <form action={action} className="flex min-h-0 flex-col">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="inviteId" value={invite.id} />
      <DialogHeader>
        <DialogTitle>{t("resendTitle")}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <DialogDescription className="text-ui text-foreground-secondary">
          {t("resendBody", { email: invite.email })}
        </DialogDescription>
        {state.error ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            {ta("cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" variant="primary" loading={pending}>
          {t("resendConfirm")}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Invite by e-mail; the outcome (sent or not, and the link) stays under the form. */
function InviteMemberForm({ workspaceId }: { workspaceId: string }) {
  const ti = useTranslations("forms.inviteMember")
  const roleLabel = useRoleLabels()
  const [state, action, pending] = useActionState(inviteMemberAction, INITIAL)
  const [email, setEmail] = useState("")

  // The outcome is shown inline under the form, so no toast; a created invite
  // clears the address so the next one starts empty.
  useActionResult(state, { onSuccess: () => setEmail(""), toastOnSuccess: false, toastOnError: false })

  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="workspaceId" value={workspaceId} />

      <div className="flex flex-wrap items-end gap-2">
        <Field
          label={ti("label")}
          htmlFor="invite-email"
          className="min-w-56 flex-1"
          error={state.fieldErrors?.email?.[0]}
        >
          <Input
            id="invite-email"
            name="email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={ti("placeholder")}
            aria-describedby={state.fieldErrors?.email ? "invite-email-error" : undefined}
            invalid={Boolean(state.fieldErrors?.email)}
          />
        </Field>

        <Field label={ti("role")} htmlFor="invite-role" className="w-full sm:w-36">
          <Select id="invite-role" name="role" defaultValue="member">
            <option value="member">{roleLabel("member")}</option>
            <option value="admin">{roleLabel("admin")}</option>
          </Select>
        </Field>

        <Button type="submit" variant="secondary" loading={pending} className="max-sm:w-full">
          {ti("submit")}
        </Button>
      </div>

      {state.error ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
      {state.invite ? <InviteOutcome {...state.invite} /> : null}
    </form>
  )
}
