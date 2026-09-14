"use server"

import { redirect } from "next/navigation"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"

export interface AuthFormState {
  error?: string
  fieldErrors?: Record<string, string[]>
  message?: string
}

const credentialsSchema = z.object({
  email: z.string().email("Enter a valid e-mail address."),
  password: z.string().min(8, "Use at least 8 characters."),
})

const signUpSchema = credentialsSchema.extend({
  fullName: z.string().min(2, "Tell us your name.").max(120),
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
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  // Deliberately generic: distinguishing "no such user" from "wrong password"
  // is a user-enumeration oracle.
  if (error) return { error: "Those credentials did not work. Try again." }

  redirect("/app")
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
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
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
    return { message: "Check your inbox to confirm your e-mail, then sign in." }
  }

  redirect("/app")
}

export async function signOut(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/login")
}
