"use client"

import { useTranslations } from "next-intl"
import { useActionState } from "react"

import { Link } from "@/i18n/navigation"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import { signIn, signUp, type AuthFormState } from "./actions"

const INITIAL: AuthFormState = {}

export function AuthForm({ mode }: { mode: "signin" | "signup" }) {
  const t = useTranslations("auth")
  const [state, action, pending] = useActionState(
    mode === "signin" ? signIn : signUp,
    INITIAL,
  )

  const signup = mode === "signup"

  return (
    <div>
      <div className="mb-8 space-y-2 text-center">
        <h1 className="text-balance text-subheading text-foreground">
          {signup ? t("signup.title") : t("signin.title")}
        </h1>
        <p className="text-pretty text-ui text-muted-foreground">
          {signup ? t("signup.subtitle") : t("signin.subtitle")}
        </p>
      </div>

      <Card className="p-6">
        <form action={action} className="space-y-4" noValidate>
          {signup ? (
            <Field
              label={t("fields.fullName")}
              htmlFor="fullName"
              required
              error={state.fieldErrors?.fullName?.[0]}
            >
              <Input
                id="fullName"
                name="fullName"
                autoComplete="name"
                required
                invalid={Boolean(state.fieldErrors?.fullName)}
              />
            </Field>
          ) : null}

          <Field label={t("fields.email")} htmlFor="email" required error={state.fieldErrors?.email?.[0]}>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              invalid={Boolean(state.fieldErrors?.email)}
            />
          </Field>

          <Field
            label={t("fields.password")}
            htmlFor="password"
            required
            hint={signup ? t("fields.passwordHint") : undefined}
            error={state.fieldErrors?.password?.[0]}
          >
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={signup ? "new-password" : "current-password"}
              required
              invalid={Boolean(state.fieldErrors?.password)}
            />
          </Field>

          {state.error ? (
            <p role="alert" className="rounded-control bg-danger-subtle px-3 py-2 text-meta text-danger-foreground">
              {state.error}
            </p>
          ) : null}

          {state.message ? (
            <p role="status" className="rounded-control bg-success-subtle px-3 py-2 text-meta text-success-foreground">
              {state.message}
            </p>
          ) : null}

          <Button type="submit" variant="primary" size="lg" className="mt-2 w-full max-sm:h-10" loading={pending}>
            {signup ? t("signup.submit") : t("signin.submit")}
          </Button>
        </form>
      </Card>

      <p className="mt-6 text-center text-caption text-muted-foreground">
        {signup ? t("signup.switchPrompt") : t("signin.switchPrompt")}{" "}
        <Link
          href={signup ? "/login" : "/signup"}
          className="rounded-hairline font-medium text-foreground-secondary transition-colors duration-[120ms] hover:text-foreground"
        >
          {signup ? t("signup.switchAction") : t("signin.switchAction")}
        </Link>
      </p>
    </div>
  )
}
