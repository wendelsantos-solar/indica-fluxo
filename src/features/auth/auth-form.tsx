"use client"

import Link from "next/link"
import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import { signIn, signUp, type AuthFormState } from "./actions"

const INITIAL: AuthFormState = {}

export function AuthForm({ mode }: { mode: "signin" | "signup" }) {
  const [state, action, pending] = useActionState(
    mode === "signin" ? signIn : signUp,
    INITIAL,
  )

  const signup = mode === "signup"

  return (
    <div className="space-y-5">
      <div className="space-y-1.5 text-center">
        <h1 className="text-[22px] font-medium tracking-[-0.02em]">
          {signup ? "Create your account" : "Welcome back"}
        </h1>
        <p className="text-[13px] text-muted-foreground">
          {signup
            ? "Set up an affiliate program in a few minutes."
            : "Sign in to your workspace."}
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4">
          <form action={action} className="space-y-4" noValidate>
            {signup ? (
              <Field
                label="Full name"
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

            <Field label="E-mail" htmlFor="email" required error={state.fieldErrors?.email?.[0]}>
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
              label="Password"
              htmlFor="password"
              required
              hint={signup ? "At least 8 characters." : undefined}
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
              <p role="alert" className="rounded-[6px] bg-danger-subtle px-3 py-2 text-[12px] text-danger-foreground">
                {state.error}
              </p>
            ) : null}

            {state.message ? (
              <p role="status" className="rounded-[6px] bg-success-subtle px-3 py-2 text-[12px] text-success-foreground">
                {state.message}
              </p>
            ) : null}

            <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending}>
              {signup ? "Create account" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="text-center text-[13px] text-muted-foreground">
        {signup ? "Already have an account? " : "No account yet? "}
        <Link
          href={signup ? "/login" : "/signup"}
          className="text-foreground underline-offset-4 hover:underline"
        >
          {signup ? "Sign in" : "Create one"}
        </Link>
      </p>
    </div>
  )
}
