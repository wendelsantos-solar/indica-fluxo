"use client"

import { useTranslations } from "next-intl"
import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useActionResult } from "@/components/ui/use-action-result"

import { createLinkAction, type AffiliateFormState } from "./actions"

const INITIAL: AffiliateFormState = {}

export function CreateLinkForm({ participationId }: { participationId: string }) {
  const t = useTranslations("forms.createLink")
  const [state, action, pending] = useActionState(createLinkAction, INITIAL)

  useActionResult(state)

  return (
    <form action={action} className="flex flex-wrap items-end gap-2" noValidate>
      <input type="hidden" name="participationId" value={participationId} />

      <Field
        label={t("name")}
        htmlFor={`link-name-${participationId}`}
        className="min-w-[160px] flex-1"
        error={state.fieldErrors?.name?.[0]}
      >
        <Input id={`link-name-${participationId}`} name="name" placeholder={t("namePlaceholder")} />
      </Field>

      <Field
        label={t("destination")}
        htmlFor={`link-url-${participationId}`}
        className="min-w-[220px] flex-[2]"
        error={state.fieldErrors?.destinationUrl?.[0]}
      >
        <Input
          id={`link-url-${participationId}`}
          name="destinationUrl"
          type="url"
          placeholder={t("destinationPlaceholder")}
        />
      </Field>

      <Button type="submit" variant="secondary" loading={pending}>
        {t("submit")}
      </Button>

      {state.error ? (
        <p role="alert" className="w-full text-meta text-danger-foreground">
          {state.error}
        </p>
      ) : null}
    </form>
  )
}
