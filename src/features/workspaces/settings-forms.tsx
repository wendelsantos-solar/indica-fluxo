"use client"

import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Input, Select } from "@/components/ui/input"

import { inviteMemberAction, updateWorkspaceAction, type FormState } from "./actions"
import { CURRENCIES, TIMEZONES } from "./options"

const INITIAL: FormState = {}

export function WorkspaceSettingsForm({
  workspaceId,
  defaultValues,
  disabled,
}: {
  workspaceId: string
  defaultValues: { name: string; defaultCurrency: string; timezone: string }
  disabled?: boolean
}) {
  const [state, action, pending] = useActionState(updateWorkspaceAction, INITIAL)

  return (
    <Card>
      <CardHeader bordered>
        <div>
          <CardTitle>Workspace</CardTitle>
          <CardDescription>
            The default currency applies to new programs; existing programs keep their own.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4" noValidate>
          <input type="hidden" name="workspaceId" value={workspaceId} />

          <Field label="Name" htmlFor="ws-name" required error={state.fieldErrors?.name?.[0]}>
            <Input
              id="ws-name"
              name="name"
              defaultValue={defaultValues.name}
              disabled={disabled}
              required
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Default currency" htmlFor="ws-currency">
              <Select
                id="ws-currency"
                name="defaultCurrency"
                defaultValue={defaultValues.defaultCurrency}
                disabled={disabled}
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.code} — {currency.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Timezone" htmlFor="ws-timezone">
              <Select
                id="ws-timezone"
                name="timezone"
                defaultValue={defaultValues.timezone}
                disabled={disabled}
              >
                {TIMEZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {state.error ? (
            <p role="alert" className="text-[12px] text-danger-foreground">
              {state.error}
            </p>
          ) : null}
          {state.success ? (
            <p role="status" className="text-[12px] text-success-foreground">
              {state.success}
            </p>
          ) : null}

          {!disabled ? (
            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={pending}>
                Save changes
              </Button>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  )
}

export function InviteMemberForm({ workspaceId }: { workspaceId: string }) {
  const [state, action, pending] = useActionState(inviteMemberAction, INITIAL)

  return (
    <form action={action} className="flex flex-wrap items-end gap-2" noValidate>
      <input type="hidden" name="workspaceId" value={workspaceId} />

      <Field
        label="Invite by e-mail"
        htmlFor="invite-email"
        className="min-w-[220px] flex-1"
        error={state.fieldErrors?.email?.[0]}
      >
        <Input id="invite-email" name="email" type="email" placeholder="teammate@company.com" />
      </Field>

      <Field label="Role" htmlFor="invite-role" className="w-[140px]">
        <Select id="invite-role" name="role" defaultValue="member">
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </Select>
      </Field>

      <Button type="submit" variant="secondary" loading={pending}>
        Send invite
      </Button>

      {state.success ? (
        <p role="status" className="w-full text-[12px] text-success-foreground">
          {state.success}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="w-full text-[12px] text-danger-foreground">
          {state.error}
        </p>
      ) : null}
    </form>
  )
}
