"use client"

import { useTranslations } from "next-intl"
import { useActionState, useState } from "react"

import { InlineAlert } from "@/components/feedback/inline-alert"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { FormSection } from "@/components/ui/form-section"
import { Input, Select } from "@/components/ui/input"

import { updateWorkspaceAction, type FormState } from "./actions"
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

