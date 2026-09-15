"use client"

import { useTranslations } from "next-intl"
import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Link } from "@/i18n/navigation"

import { signIn, type SignInState } from "./actions"
import { AUTH_LINK, AuthHeading, FormAlert, FormNotice, errorId, useSubmit } from "./auth-ui"
import { PasswordInput } from "./password-input"

const INITIAL: SignInState = { status: "idle" }

export function SignInForm({
  next,
  linkExpired,
  defaultEmail,
}: {
  next?: string
  linkExpired?: boolean
  /** From an invitation link for an address that already has an account (`?email=`). */
  defaultEmail?: string
}) {
  const t = useTranslations("auth")
  const [state, dispatch, pending] = useActionState(signIn, INITIAL)
  const onSubmit = useSubmit(dispatch, pending)

  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined
  const formError = state.status === "error" ? state.error : undefined

  return (
    <>
      <AuthHeading title={t("signin.title")} description={t("signin.subtitle")} />

      {linkExpired && state.status === "idle" ? (
        <FormNotice className="mb-6">
          {t.rich("signin.linkExpired", {
            link: (chunks) => (
              <Link href="/forgot-password" className={AUTH_LINK}>
                {chunks}
              </Link>
            ),
          })}
        </FormNotice>
      ) : null}

      <form action={dispatch} onSubmit={onSubmit} className="space-y-4" noValidate>
        {/* Validated again on the server; the page only forwards it. */}
        {next ? <input type="hidden" name="next" value={next} /> : null}

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
            defaultValue={defaultEmail}
            invalid={Boolean(fieldErrors?.email)}
            aria-describedby={errorId("email", fieldErrors?.email)}
          />
        </Field>

        {/* The link sits in the label row visually but after the input in the
            DOM, so tabbing goes e-mail → password → "forgot" → submit. */}
        <div className="relative">
          <Field label={t("fields.password")} htmlFor="password" error={fieldErrors?.password?.[0]}>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="current-password"
              required
              invalid={Boolean(fieldErrors?.password)}
              aria-describedby={errorId("password", fieldErrors?.password)}
            />
          </Field>
          <Link href="/forgot-password" className="absolute right-0 top-0 rounded-hairline text-meta text-muted-foreground underline-offset-4 transition-colors duration-[120ms] hover:text-foreground hover:underline">
            {t("signin.forgot")}
          </Link>
        </div>

        {formError ? <FormAlert>{formError}</FormAlert> : null}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full max-sm:h-10"
          loading={pending}
        >
          {t("signin.submit")}
        </Button>
      </form>

      <p className="mt-6 text-caption text-muted-foreground">
        {t("signin.switchPrompt")}{" "}
        <Link href="/signup" className={AUTH_LINK}>
          {t("signin.switchAction")}
        </Link>
      </p>
    </>
  )
}
