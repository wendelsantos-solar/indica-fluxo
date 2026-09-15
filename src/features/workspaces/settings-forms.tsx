"use client"

import { useTranslations } from "next-intl"
import { useActionState, useState } from "react"

import { InlineAlert } from "@/components/feedback/inline-alert"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { FormSection } from "@/components/ui/form-section"
import { Input, Select } from "@/components/ui/input"
import { useActionResult } from "@/components/ui/use-action-result"

import { inviteMemberAction, updateWorkspaceAction, type FormState } from "./actions"
import type { SelectOption } from "./options"

const INITIAL: FormState = {}

export function WorkspaceSettingsForm({
  workspaceId,
  defaultValues,
  currencies,
  timezones,
  disabledReason,
}: {
  workspaceId: string
  defaultValues: { name: string; defaultCurrency: string; timezone: string }
  /** Labelled on the server, in the reader's language. */
  currencies: SelectOption[]
  timezones: SelectOption[]
  /** Set when the reader cannot change the workspace; says why. */
  disabledReason?: string
}) {
  const t = useTranslations("forms.workspace")
  const [state, action, pending] = useActionState(updateWorkspaceAction, INITIAL)
  const disabled = Boolean(disabledReason)

  // Controlled, so a failed save keeps what was typed instead of snapping back
  // when React resets the form after the action.
  const [values, setValues] = useState(defaultValues)

  // A zone saved before the option list existed must still be selectable.
  const zoneOptions = timezones.some((zone) => zone.value === values.timezone)
    ? timezones
    : [{ value: values.timezone, label: values.timezone }, ...timezones]

  return (
    <Card>
      <form action={action} noValidate>
        <input type="hidden" name="workspaceId" value={workspaceId} />

        <FormSection title={t("title")} description={t("description")}>
          <Field label={t("name")} htmlFor="ws-name" required error={state.fieldErrors?.name?.[0]}>
            <Input
              id="ws-name"
              name="name"
              value={values.name}
              onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
              disabled={disabled}
              required
              aria-describedby={state.fieldErrors?.name ? "ws-name-error" : undefined}
              invalid={Boolean(state.fieldErrors?.name)}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("currency")} htmlFor="ws-currency" error={state.fieldErrors?.defaultCurrency?.[0]}>
              <Select
                id="ws-currency"
                name="defaultCurrency"
                value={values.defaultCurrency}
                onChange={(event) =>
                  setValues((current) => ({ ...current, defaultCurrency: event.target.value }))
                }
                disabled={disabled}
              >
                {currencies.map((currency) => (
                  <option key={currency.value} value={currency.value}>
                    {currency.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t("timezone")} htmlFor="ws-timezone" error={state.fieldErrors?.timezone?.[0]}>
              <Select
                id="ws-timezone"
                name="timezone"
                value={values.timezone}
                onChange={(event) => setValues((current) => ({ ...current, timezone: event.target.value }))}
                disabled={disabled}
              >
                {zoneOptions.map((zone) => (
                  <option key={zone.value} value={zone.value}>
                    {zone.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </FormSection>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-4 py-3 sm:px-5">
          {disabledReason ? (
            <InlineAlert className="w-full">{disabledReason}</InlineAlert>
          ) : (
            <>
              {state.error ? (
                <InlineAlert tone="danger" className="mr-auto">
                  {state.error}
                </InlineAlert>
              ) : state.success ? (
                <InlineAlert tone="success" className="mr-auto">
                  {state.success}
                </InlineAlert>
              ) : null}
              <Button type="submit" variant="primary" loading={pending}>
                {t("save")}
              </Button>
            </>
          )}
        </div>
      </form>
    </Card>
  )
}

export function InviteMemberForm({ workspaceId }: { workspaceId: string }) {
  const ti = useTranslations("forms.inviteMember")
  const tr = useTranslations("common.roles")
  const [state, action, pending] = useActionState(inviteMemberAction, INITIAL)
  const [email, setEmail] = useState("")

  // The outcome is shown inline under the form, so no toast; a sent invite
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
            <option value="member">{tr("member")}</option>
            <option value="admin">{tr("admin")}</option>
          </Select>
        </Field>

        <Button type="submit" variant="secondary" loading={pending} className="max-sm:w-full">
          {ti("submit")}
        </Button>
      </div>

      {state.success ? <InlineAlert tone="success">{state.success}</InlineAlert> : null}
      {state.error ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
    </form>
  )
}
