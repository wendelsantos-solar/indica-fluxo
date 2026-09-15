"use client"

import { useTranslations } from "next-intl"
import * as React from "react"
import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Link } from "@/i18n/navigation"

import { signUp, type SignUpState } from "./actions"
import { ALERT_LINK, AUTH_LINK, AuthHeading, FormAlert, errorId, useSubmit } from "./auth-ui"
import { CheckEmail } from "./check-email"
import { PasswordInput } from "./password-input"

const INITIAL: SignUpState = { status: "idle" }

/**
 * Sign-up, and the "check your e-mail" screen that replaces it.
 *
 * The confirmation is a state of this component rather than a route: the
 * address lives in the action result, so a resend never loses it, and the
 * address is never put in a URL. "Use another e-mail" dismisses that one
 * result and remounts an empty form.
 *
 * `invitedEmail` comes from an invitation link (`?email=…&invite=1`, see
 * `parseInviteQuery`): the address is filled in and locked, because the
 * invitation is claimed by that exact address. It grants nothing by itself —
 * the account still has to be confirmed from that inbox.
 */
export function SignUpFlow({ invitedEmail }: { invitedEmail?: string } = {}) {
  const [state, dispatch, pending] = useActionState(signUp, INITIAL)
  const [dismissed, setDismissed] = React.useState<SignUpState | null>(null)
  const [formKey, setFormKey] = React.useState(0)

  if (state.status === "confirm" && state !== dismissed) {
    return (
      <CheckEmail
        email={state.email}
        onUseAnother={() => {
          setDismissed(state)
          setFormKey((key) => key + 1)
        }}
      />
    )
  }

  return (
    <SignUpForm
      key={formKey}
      // A dismissed confirmation must not leave its (stale) result on the new form.
      state={state === dismissed ? INITIAL : state}
      dispatch={dispatch}
      pending={pending}
      autoFocus={formKey > 0}
      invitedEmail={invitedEmail}
    />
  )
}

function SignUpForm({
  state,
  dispatch,
  pending,
  autoFocus,
  invitedEmail,
}: {
  state: SignUpState
  dispatch: (payload: FormData) => void
  pending: boolean
  autoFocus: boolean
  invitedEmail?: string
}) {
  const t = useTranslations("auth")
  const tErrors = useTranslations("errors")
  const onSubmit = useSubmit(dispatch, pending)

  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined
  const formError = state.status === "error" ? state.error : undefined

  return (
    <>
      {invitedEmail ? (
        <AuthHeading
          title={t("signup.inviteTitle")}
          description={t("signup.inviteSubtitle")}
          hint={t("signup.inviteHint")}
        />
      ) : (
        <AuthHeading title={t("signup.title")} description={t("signup.subtitle")} />
      )}

      <form action={dispatch} onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label={t("fields.fullName")} htmlFor="fullName" error={fieldErrors?.fullName?.[0]}>
          <Input
            id="fullName"
            name="fullName"
            autoComplete="name"
            required
            // Only after "use another e-mail", where the form replaced a screen.
            autoFocus={autoFocus}
            invalid={Boolean(fieldErrors?.fullName)}
            aria-describedby={errorId("fullName", fieldErrors?.fullName)}
          />
        </Field>

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
            defaultValue={invitedEmail}
            // Locked, not disabled: a disabled field is not submitted.
            readOnly={Boolean(invitedEmail)}
            invalid={Boolean(fieldErrors?.email)}
            aria-describedby={errorId("email", fieldErrors?.email)}
          />
        </Field>
        {invitedEmail ? (
          <p className="-mt-2 text-meta text-muted-foreground">
            {t("signup.inviteLocked")}{" "}
            <Link href="/signup" className={AUTH_LINK}>
              {t("signup.inviteUseAnother")}
            </Link>
          </p>
        ) : null}

        <Field label={t("fields.password")} htmlFor="password" error={fieldErrors?.password?.[0]}>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={8}
            showRequirement
            invalid={Boolean(fieldErrors?.password)}
            aria-describedby={errorId("password", fieldErrors?.password)}
          />
        </Field>

        {formError ? <FormAlert>{formError}</FormAlert> : null}

        {state.status === "unavailable" ? (
          <FormAlert>
            {tErrors.rich("emailUnavailable", {
              login: (chunks) => (
                <Link
                  href={invitedEmail ? { pathname: "/login", query: { email: invitedEmail } } : "/login"}
                  className={ALERT_LINK}
                >
                  {chunks}
                </Link>
              ),
              reset: (chunks) => (
                <Link href="/forgot-password" className={ALERT_LINK}>
                  {chunks}
                </Link>
              ),
            })}
          </FormAlert>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full max-sm:h-10"
          loading={pending}
        >
          {t("signup.submit")}
        </Button>
      </form>

      <p className="mt-6 text-caption text-muted-foreground">
        {t("signup.switchPrompt")}{" "}
        <Link
          href={invitedEmail ? { pathname: "/login", query: { email: invitedEmail } } : "/login"}
          className={AUTH_LINK}
        >
          {t("signup.switchAction")}
        </Link>
      </p>
    </>
  )
}
