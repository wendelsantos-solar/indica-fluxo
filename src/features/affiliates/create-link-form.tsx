"use client"

import { ChevronDown, Plus } from "lucide-react"
import { useTranslations } from "next-intl"
import * as React from "react"
import { useActionState } from "react"

import { InlineAlert } from "@/components/feedback/inline-alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useActionResult } from "@/components/ui/use-action-result"
import { cn } from "@/lib/utils"

import { createLinkAction, type CreateLinkFormState } from "./actions"

const INITIAL: CreateLinkFormState = {}

/**
 * Creating a named link is occasional, so the form stays behind a quiet
 * "Criar link" until asked for. Feedback is inline only: errors sit in the
 * form, and a success closes it and says so where the button was — the new
 * link is already in the list above, with its URL and copy button.
 *
 * React resets a `<form action>` after every submission; inputs take their
 * `defaultValue` from what the action echoes back, so a validation error does
 * not wipe what the affiliate typed.
 */
export function CreateLinkForm({ participationId }: { participationId: string }) {
  const t = useTranslations("forms.createLink")
  const tActions = useTranslations("common.actions")
  const [state, action, pending] = useActionState(createLinkAction, INITIAL)
  const [open, setOpen] = React.useState(false)
  const [optionsOpen, setOptionsOpen] = React.useState(false)
  const [showSuccess, setShowSuccess] = React.useState(false)
  const [returnFocus, setReturnFocus] = React.useState(false)

  useActionResult(state, {
    toastOnSuccess: false,
    toastOnError: false,
    onSuccess: () => {
      setOpen(false)
      setOptionsOpen(false)
      setShowSuccess(true)
      setReturnFocus(true)
    },
  })

  const triggerId = `link-form-trigger-${participationId}`
  const panelId = `link-form-${participationId}`
  const nameId = `link-name-${participationId}`
  const urlId = `link-url-${participationId}`
  const campaignId = `link-campaign-${participationId}`
  const optionsId = `link-options-${participationId}`

  const errors = state.fieldErrors ?? {}
  const values = state.values ?? {}
  const showOptions = optionsOpen || Boolean(errors.campaign?.length)

  // When the form closes — cancelled or created — focus returns to the control
  // that opened it, instead of falling back to the top of the document.
  React.useEffect(() => {
    if (!open && returnFocus) document.getElementById(triggerId)?.focus()
  }, [open, returnFocus, triggerId])

  function close() {
    setOpen(false)
    setReturnFocus(true)
  }

  if (!open) {
    return (
      <div className="space-y-3">
        {showSuccess && state.success ? (
          <InlineAlert tone="success">{state.success}</InlineAlert>
        ) : null}
        <Button
          id={triggerId}
          type="button"
          variant="secondary"
          aria-expanded={false}
          className="max-sm:h-11 max-sm:w-full"
          onClick={() => {
            setShowSuccess(false)
            setReturnFocus(false)
            setOpen(true)
          }}
        >
          <Plus aria-hidden="true" />
          {t("open")}
        </Button>
      </div>
    )
  }

  return (
    <Card id={panelId}>
      <form action={action} noValidate>
        <input type="hidden" name="participationId" value={participationId} />

        <CardHeader bordered>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t("name")}
              htmlFor={nameId}
              hint={t("nameHint")}
              error={errors.name?.[0]}
            >
              <Input
                id={nameId}
                name="name"
                autoComplete="off"
                autoFocus
                maxLength={80}
                defaultValue={values.name}
                placeholder={t("namePlaceholder")}
                invalid={Boolean(errors.name?.length)}
                aria-describedby={errors.name?.length ? `${nameId}-error` : `${nameId}-hint`}
              />
            </Field>

            <Field
              label={t("destination")}
              htmlFor={urlId}
              hint={t("destinationHint")}
              error={errors.destinationUrl?.[0]}
            >
              <Input
                id={urlId}
                name="destinationUrl"
                type="url"
                maxLength={2048}
                inputMode="url"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                defaultValue={values.destinationUrl}
                placeholder={t("destinationPlaceholder")}
                invalid={Boolean(errors.destinationUrl?.length)}
                aria-describedby={
                  errors.destinationUrl?.length ? `${urlId}-error` : `${urlId}-hint`
                }
              />
            </Field>
          </div>

          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={showOptions}
              aria-controls={optionsId}
              className="-ml-2.5 max-sm:h-11"
              onClick={() => setOptionsOpen((value) => !value)}
            >
              {t("options")}
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "transition-transform duration-[120ms]",
                  showOptions && "rotate-180",
                )}
              />
            </Button>

            {/* Hidden, not unmounted: the campaign still submits when collapsed. */}
            <div id={optionsId} hidden={!showOptions} className="grid gap-4 pt-3 sm:grid-cols-2">
              <Field
                label={t("campaign")}
                htmlFor={campaignId}
                hint={t("campaignHint")}
                error={errors.campaign?.[0]}
              >
                <Input
                  id={campaignId}
                  name="campaign"
                  autoComplete="off"
                  maxLength={80}
                  defaultValue={values.campaign}
                  placeholder={t("campaignPlaceholder")}
                  invalid={Boolean(errors.campaign?.length)}
                  aria-describedby={
                    errors.campaign?.length ? `${campaignId}-error` : `${campaignId}-hint`
                  }
                />
              </Field>
            </div>
          </div>

          {state.error ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
        </CardContent>

        <CardFooter className="flex-col-reverse items-stretch sm:flex-row sm:items-center sm:justify-end">
          <Button type="button" variant="ghost" className="max-sm:h-11" onClick={close}>
            {tActions("cancel")}
          </Button>
          <Button type="submit" variant="secondary" loading={pending} className="max-sm:h-11">
            {t("submit")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
