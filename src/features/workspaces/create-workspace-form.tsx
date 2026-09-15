"use client"

import { useTranslations } from "next-intl"
import { useActionState, useState, useSyncExternalStore } from "react"

import { InlineAlert } from "@/components/feedback/inline-alert"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Input, Select } from "@/components/ui/input"
import { SettingsDisclosure } from "@/features/onboarding/settings-disclosure"

import { createWorkspaceAction, type FormState } from "./actions"
import { TIMEZONES, type SelectOption } from "./options"

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

/** "Horário de Brasília (GMT-3)" out of "Horário de Brasília (GMT-3) · America/Sao Paulo". */
function shortTimezoneLabel(options: readonly SelectOption[], zone: string): string {
  const label = options.find((option) => option.value === zone)?.label ?? zone
  return label.split(" · ")[0] ?? label
}

/**
 * Step 1 of onboarding: one question. Currency and timezone have good
 * defaults — the locale's currency and the browser's zone — so they wait
 * behind a disclosure that shows what was chosen.
 */
export function CreateWorkspaceForm({
  defaultCurrency,
  currencies,
  timezones,
}: {
  defaultCurrency: string
  /** Labelled on the server (`currencyOptions`), so the text cannot differ at hydration. */
  currencies: SelectOption[]
  /** `timezoneOptions`: the same friendly names as workspace settings. */
  timezones: SelectOption[]
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
          summary={`${currency} · ${shortTimezoneLabel(timezones, timezone)}`}
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
                <option key={option.value} value={option.value}>
                  {option.label}
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
              {timezones.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        </SettingsDisclosure>

        {state.error ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}

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
