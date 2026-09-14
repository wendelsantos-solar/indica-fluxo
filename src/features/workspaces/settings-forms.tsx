"use client"

import { useTranslations } from "next-intl"
import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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
  const t = useTranslations("forms.workspace")
  const [state, action, pending] = useActionState(updateWorkspaceAction, INITIAL)

  return (
    <Card>
      <form action={action} noValidate>
        <input type="hidden" name="workspaceId" value={workspaceId} />

        <section className="grid gap-4 p-4 md:grid-cols-3 md:gap-8 md:py-6">
          <div>
            <h2 className="text-caption font-medium text-foreground">{t("title")}</h2>
            <p className="mt-0.5 text-caption text-muted-foreground">{t("description")}</p>
          </div>

          <div className="space-y-4 md:col-span-2">
            <Field label={t("name")} htmlFor="ws-name" required error={state.fieldErrors?.name?.[0]}>
              <Input
                id="ws-name"
                name="name"
                defaultValue={defaultValues.name}
                disabled={disabled}
                required
                invalid={Boolean(state.fieldErrors?.name)}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("currency")} htmlFor="ws-currency">
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

              <Field label={t("timezone")} htmlFor="ws-timezone">
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
          </div>
        </section>

        {!disabled || state.error || state.success ? (
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-4 py-3">
            {state.error ? (
              <p role="alert" className="mr-auto text-meta text-danger-foreground">
                {state.error}
              </p>
            ) : state.success ? (
              <p role="status" className="mr-auto text-meta text-success-foreground">
                {state.success}
              </p>
            ) : null}
            {!disabled ? (
              <Button type="submit" variant="primary" loading={pending}>
                {t("save")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </form>
    </Card>
  )
}

export function InviteMemberForm({ workspaceId }: { workspaceId: string }) {
  const ti = useTranslations("forms.inviteMember")
  const tr = useTranslations("common.roles")
  const [state, action, pending] = useActionState(inviteMemberAction, INITIAL)

  return (
    <form action={action} className="flex flex-wrap items-end gap-2" noValidate>
      <input type="hidden" name="workspaceId" value={workspaceId} />

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
          placeholder={ti("placeholder")}
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

      {state.success ? (
        <p role="status" className="w-full text-meta text-success-foreground">
          {state.success}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="w-full text-meta text-danger-foreground">
          {state.error}
        </p>
      ) : null}
    </form>
  )
}
