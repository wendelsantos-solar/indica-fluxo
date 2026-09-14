"use client"

import { useTranslations } from "next-intl"
import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useActionResult } from "@/components/ui/use-action-result"

import { createLinkAction, type AffiliateFormState } from "./actions"

const INITIAL: AffiliateFormState = {}

/**
 * A one-off form, so it earns a card. Fields stack on a phone and sit side by
 * side from `sm`; the submit lives in the footer, so a field error never
 * knocks it out of line with the inputs.
 */
export function CreateLinkForm({ participationId }: { participationId: string }) {
  const t = useTranslations("forms.createLink")
  const [state, action, pending] = useActionState(createLinkAction, INITIAL)

  useActionResult(state)

  const nameId = `link-name-${participationId}`
  const urlId = `link-url-${participationId}`

  return (
    <Card>
      <form action={action} noValidate>
        <input type="hidden" name="participationId" value={participationId} />

        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label={t("name")} htmlFor={nameId} error={state.fieldErrors?.name?.[0]}>
            <Input
              id={nameId}
              name="name"
              autoComplete="off"
              placeholder={t("namePlaceholder")}
              invalid={Boolean(state.fieldErrors?.name?.length)}
              aria-describedby={state.fieldErrors?.name?.length ? `${nameId}-error` : undefined}
            />
          </Field>

          <Field
            label={t("destination")}
            htmlFor={urlId}
            error={state.fieldErrors?.destinationUrl?.[0]}
          >
            <Input
              id={urlId}
              name="destinationUrl"
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder={t("destinationPlaceholder")}
              invalid={Boolean(state.fieldErrors?.destinationUrl?.length)}
              aria-describedby={
                state.fieldErrors?.destinationUrl?.length ? `${urlId}-error` : undefined
              }
            />
          </Field>
        </CardContent>

        <CardFooter className="flex-col items-stretch sm:flex-row sm:items-center">
          {state.error ? (
            <p role="alert" className="text-meta text-danger-foreground">
              {state.error}
            </p>
          ) : null}
          <Button
            type="submit"
            variant="secondary"
            loading={pending}
            className="max-sm:h-11 max-sm:w-full sm:ml-auto"
          >
            {t("submit")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
