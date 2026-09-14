"use client"

import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Input, Select } from "@/components/ui/input"

import { createWorkspaceAction, type FormState } from "./actions"
import { CURRENCIES, TIMEZONES } from "./options"

const INITIAL: FormState = {}

export function CreateWorkspaceForm() {
  const [state, action, pending] = useActionState(createWorkspaceAction, INITIAL)

  return (
    <Card>
      <CardContent>
        <form action={action} className="space-y-4" noValidate>
          <Field
            label="Workspace name"
            htmlFor="name"
            required
            hint="Usually your company or product name."
            error={state.fieldErrors?.name?.[0]}
          >
            <Input
              id="name"
              name="name"
              placeholder="Acme SaaS"
              autoComplete="organization"
              required
              invalid={Boolean(state.fieldErrors?.name)}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Default currency" htmlFor="defaultCurrency">
              <Select id="defaultCurrency" name="defaultCurrency" defaultValue="USD">
                {CURRENCIES.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.code} — {currency.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Timezone" htmlFor="timezone">
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

          <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending}>
            Continue
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
