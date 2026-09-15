"use client"

import { CircleCheck, KeyRound } from "lucide-react"
import { useTranslations } from "next-intl"
import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Link } from "@/i18n/navigation"

import { updatePassword, type ResetPasswordState } from "./actions"
import { AuthHeading, FormAlert, errorId, useSubmit } from "./auth-ui"
import { PasswordInput } from "./password-input"

const INITIAL: ResetPasswordState = { status: "idle" }

/** Where an accepted invitation continues once a password is chosen. */
const INVITE_DESTINATION = { affiliate: "/affiliate/overview", member: "/app" } as const

/**
 * The recovery session is already in the cookie when this renders: the
 * callback exchanged the e-mailed code for it. Choosing a password is the
 * whole screen.
 *
 * `invite` is set when the session came from an invitation e-mail
 * (`?invite=affiliate|member`): the same form, worded as choosing a first
 * password, continuing to the portal or the workspace.
 */
export function ResetPasswordForm({
  email,
  invite,
}: {
  email: string
  invite?: keyof typeof INVITE_DESTINATION
}) {
  const t = useTranslations("auth.reset")
  const tFields = useTranslations("auth.fields")
  const [state, dispatch, pending] = useActionState(updatePassword, INITIAL)
  const onSubmit = useSubmit(dispatch, pending)

  if (state.status === "done") {
    return (
      <>
        <AuthHeading
          icon={CircleCheck}
          focusOnMount
          title={invite ? t("inviteDoneTitle") : t("doneTitle")}
          description={invite ? t("inviteDoneBody") : t("doneBody")}
        />
        <Button asChild variant="primary" size="lg" className="w-full max-sm:h-10">
          <Link href={invite ? INVITE_DESTINATION[invite] : "/app"}>
            {invite === "affiliate"
              ? t("inviteDoneActionAffiliate")
              : invite === "member"
                ? t("inviteDoneActionMember")
                : t("doneAction")}
          </Link>
        </Button>
      </>
    )
  }

  // The session lapsed between opening the page and submitting.
  if (state.status === "expired") return <ResetLinkExpired focusOnMount />

  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined
  const formError = state.status === "error" ? state.error : undefined

  return (
    <>
      {invite ? (
        <AuthHeading title={t("inviteTitle")} description={t("inviteSubtitle", { email })} />
      ) : (
        <AuthHeading title={t("title")} description={t("subtitle")} />
      )}

      <form action={dispatch} onSubmit={onSubmit} className="space-y-4" noValidate>
        {/* Lets a password manager file the new password under the right
            account. Not submitted: the session already says whose it is. */}
        <input
          type="text"
          autoComplete="username"
          value={email}
          readOnly
          hidden
          aria-hidden="true"
          tabIndex={-1}
        />
        <Field label={tFields("newPassword")} htmlFor="password" error={fieldErrors?.password?.[0]}>
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

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full max-sm:h-10"
          loading={pending}
        >
          {t("submit")}
        </Button>
      </form>
    </>
  )
}

export function ResetLinkExpired({ focusOnMount = false }: { focusOnMount?: boolean }) {
  const t = useTranslations("auth.reset")

  return (
    <>
      <AuthHeading
        icon={KeyRound}
        focusOnMount={focusOnMount}
        title={t("expiredTitle")}
        description={t("expiredBody")}
      />
      <div className="space-y-3">
        <Button asChild variant="primary" size="lg" className="w-full max-sm:h-10">
          <Link href="/forgot-password">{t("expiredAction")}</Link>
        </Button>
        <Button asChild variant="ghost" size="lg" className="w-full max-sm:h-10">
          <Link href="/login">{t("backToLogin")}</Link>
        </Button>
      </div>
    </>
  )
}
