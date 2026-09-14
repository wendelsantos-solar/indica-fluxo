"use server"

import { actionError, successMessage, translateFieldErrors } from "@/i18n/errors"
import { getLocale } from "next-intl/server"

import { redirect } from "@/i18n/navigation"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"

export interface AuthFormState {
  error?: string
  fieldErrors?: Record<string, string[]>
  message?: string
}

const credentialsSchema = z.object({
  email: z.string().email("emailInvalid"),
  password: z.string().min(8, "passwordLength"),
})

const signUpSchema = credentialsSchema.extend({
  fullName: z.string().min(2, "fullName").max(120),
})

export async function signIn(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  })

  if (!parsed.success) {
    return {
      fieldErrors: await translateFieldErrors(z.flattenError(parsed.error).fieldErrors),
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  // Deliberately generic: distinguishing "no such user" from "wrong password"
  // is a user-enumeration oracle.
  if (error) return { error: await actionError(null, "badCredentials") }

  return redirect({ href: "/app", locale: await getLocale() })
}

export async function signUp(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    fullName: formData.get("fullName"),
  })

  if (!parsed.success) {
    return {
      fieldErrors: await translateFieldErrors(z.flattenError(parsed.error).fieldErrors),
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.fullName } },
  })

  if (error) return { error: error.message }

  // When e-mail confirmation is enabled there is no session yet.
  if (!data.session) {
    return { message: await successMessage("confirmEmail") }
  }

  return redirect({ href: "/app", locale: await getLocale() })
}

export async function signOut(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return redirect({ href: "/login", locale: await getLocale() })
}
