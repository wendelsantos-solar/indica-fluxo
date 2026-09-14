"use client"

import { useTranslations } from "next-intl"
import { useActionState, useState, useSyncExternalStore } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Input, Select } from "@/components/ui/input"
import { SettingsDisclosure } from "@/features/onboarding/settings-disclosure"

import { createWorkspaceAction, type FormState } from "./actions"
import { TIMEZONES } from "./options"

const INITIAL: FormState = {}
const FALLBACK_TIMEZONE = "UTC"

const noSubscription = () => () => {}

/** The browser's zone when we offer it, else UTC. */
function browserTimezone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return (TIMEZONES as readonly string[]).includes(zone) ? zone : FALLBACK_TIMEZONE
  } catch {
    return FALLBACK_TIMEZONE
  }
}

/**
 * Step 1 of onboarding: one question. Currency and timezone have good
 * defaults — the locale's currency and the browser's zone — so they wait
 * behind a disclosure that shows what was chosen.
 */
export function CreateWorkspaceForm({
  defaultCurrency,
  currencies,
}: {
  defaultCurrency: string
  /** Labelled on the server, so the option text cannot differ at hydration. */
  currencies: { code: string; label: string }[]
}) {
  const t = useTranslations("forms.createWorkspace")
  const [state, action, pending] = useActionState(createWorkspaceAction, INITIAL)

  // Controlled, so a failed submission does not wipe what was typed when React
  // resets the form after the action.
  const [name, setName] = useState("")
  const [currency, setCurrency] = useState(defaultCurrency)
  const [chosenTimezone, setChosenTimezone] = useState<string | null>(null)

  // The server cannot know the browser's zone. Reading it as an external store
  // renders UTC on the server and the first client pass, then the real zone —
  // no hydration mismatch and no effect that sets state.
  const detectedTimezone = useSyncExternalStore(
    noSubscription,
    browserTimezone,
    () => FALLBACK_TIMEZONE,
  )
  const timezone = chosenTimezone ?? detectedTimezone

  const preferencesError =
    state.fieldErrors?.defaultCurrency?.[0] ?? state.fieldErrors?.timezone?.[0]

  return (
    <Card className="p-4 sm:p-6">
      <form action={action} className="space-y-4" noValidate>
        <Field
          label={t("name")}
          htmlFor="name"
          hint={t("nameHint")}
          error={state.fieldErrors?.name?.[0]}
        >
          <Input
            id="name"
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("namePlaceholder")}
            autoComplete="organization"
            required
            aria-describedby={state.fieldErrors?.name ? "name-error" : "name-hint"}
            invalid={Boolean(state.fieldErrors?.name)}
          />
        </Field>

        <SettingsDisclosure
          title={t("preferences")}
          summary={`${currency} · ${timezone}`}
          forceOpen={Boolean(preferencesError)}
        >
          <Field
            label={t("currency")}
            htmlFor="defaultCurrency"
            hint={t("currencyHint")}
            error={state.fieldErrors?.defaultCurrency?.[0]}
          >
            <Select
              id="defaultCurrency"
              name="defaultCurrency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              {currencies.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.code} — {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t("timezone")} htmlFor="timezone" error={state.fieldErrors?.timezone?.[0]}>
            <Select
              id="timezone"
              name="timezone"
              value={timezone}
              onChange={(event) => setChosenTimezone(event.target.value)}
            >
              {TIMEZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </Select>
          </Field>
        </SettingsDisclosure>

        {state.error ? (
          <p
            role="alert"
            className="rounded-control bg-danger-subtle px-3 py-2 text-meta text-danger-foreground"
          >
            {state.error}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full max-sm:h-11"
          loading={pending}
        >
          {t("submit")}
        </Button>
      </form>
    </Card>
  )
}
