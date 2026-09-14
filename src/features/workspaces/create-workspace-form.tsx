"use client"

import { useTranslations } from "next-intl"
import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Input, Select } from "@/components/ui/input"

import { createWorkspaceAction, type FormState } from "./actions"
import { CURRENCIES, TIMEZONES } from "./options"

const INITIAL: FormState = {}

export function CreateWorkspaceForm() {
  const t = useTranslations("forms.createWorkspace")
  const [state, action, pending] = useActionState(createWorkspaceAction, INITIAL)

  return (
    <Card className="p-6">
      <form action={action} className="space-y-4" noValidate>
        <Field
          label={t("name")}
          htmlFor="name"
          required
          hint={t("nameHint")}
          error={state.fieldErrors?.name?.[0]}
        >
          <Input
            id="name"
            name="name"
            placeholder={t("namePlaceholder")}
            autoComplete="organization"
            required
            invalid={Boolean(state.fieldErrors?.name)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("currency")} htmlFor="defaultCurrency">
            <Select id="defaultCurrency" name="defaultCurrency" defaultValue="USD">
              {CURRENCIES.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.code} — {currency.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t("timezone")} htmlFor="timezone">
            <Select id="timezone" name="timezone" defaultValue="UTC">
              {TIMEZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {state.error ? (
          <p role="alert" className="rounded-control bg-danger-subtle px-3 py-2 text-meta text-danger-foreground">
            {state.error}
          </p>
        ) : null}

        <Button type="submit" variant="primary" size="lg" className="mt-2 w-full max-sm:h-10" loading={pending}>
          {t("submit")}
        </Button>
      </form>
    </Card>
  )
}
