import "server-only"

import { cache } from "react"
import { getLocale } from "next-intl/server"

import { redirect } from "@/i18n/navigation"

import { createClient } from "@/lib/supabase/server"

export interface SessionUser {
  id: string
  email: string
  /** `full_name` from sign-up metadata, when the person gave one. */
  name: string | null
}

/**
 * `cache()` dedupes the Supabase round trip across a single render pass, so a
 * layout and five server components share one call.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) return null
  const fullName = user.user_metadata?.full_name
  return {
    id: user.id,
    email: user.email,
    name: typeof fullName === "string" && fullName.trim() ? fullName.trim() : null,
  }
})

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) {
    // `redirect` throws, but next-intl types it as `void` rather than `never`,
    // so the narrowing has to be written out.
    redirect({ href: "/login", locale: await getLocale() })
    throw new Error("unreachable: redirect() does not return")
  }
  return user
}
