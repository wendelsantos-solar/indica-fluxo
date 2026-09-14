"use client"

import { ArrowLeft, MailCheck } from "lucide-react"
import { useTranslations } from "next-intl"
import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Link } from "@/i18n/navigation"

import { requestPasswordReset, type ForgotPasswordState } from "./actions"
import { AUTH_LINK, AuthHeading, FormAlert, errorId, useSubmit } from "./auth-ui"

const INITIAL: ForgotPasswordState = { status: "idle" }

/**
 * Asks for an address and always answers the same way. Whether an account
 * exists for it is never shown: the confirmation is identical either way.
 */
export function ForgotPasswordForm() {
  const t = useTranslations("auth")
  const [state, dispatch, pending] = useActionState(requestPasswordReset, INITIAL)
  const onSubmit = useSubmit(dispatch, pending)

  if (state.status === "sent") {
    return (
      <>
        <AuthHeading
          icon={MailCheck}
          focusOnMount
          title={t("forgot.sentTitle")}
          description={t.rich("forgot.sentBody", {
            strong: (chunks) => (
              <span className="break-words font-medium text-foreground">{chunks}</span>
            ),
            email: state.email,
          })}
          hint={t("forgot.sentHint")}
        />
        <Button asChild variant="secondary" size="lg" className="w-full max-sm:h-10">
          <Link href="/login">
            <ArrowLeft aria-hidden="true" />
            {t("forgot.back")}
          </Link>
        </Button>
      </>
    )
  }

  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined
  const formError = state.status === "error" ? state.error : undefined

  return (
    <>
      <AuthHeading title={t("forgot.title")} description={t("forgot.subtitle")} />

      <form action={dispatch} onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label={t("fields.email")} htmlFor="email" error={fieldErrors?.email?.[0]}>
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            invalid={Boolean(fieldErrors?.email)}
            aria-describedby={errorId("email", fieldErrors?.email)}
          />
        </Field>

        {formError ? <FormAlert>{formError}</FormAlert> : null}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full max-sm:h-10"
          loading={pending}
        >
          {t("forgot.submit")}
        </Button>
      </form>

      <p className="mt-6 text-caption text-muted-foreground">
        <Link href="/login" className={AUTH_LINK}>
          {t("forgot.back")}
        </Link>
      </p>
    </>
  )
}
