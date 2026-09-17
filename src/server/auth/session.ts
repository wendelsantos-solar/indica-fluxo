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

function toSessionUser(id: string, email: unknown, metadata: unknown): SessionUser | null {
  if (typeof email !== "string" || !email) return null
  const fullName =
    metadata && typeof metadata === "object" ? (metadata as { full_name?: unknown }).full_name : undefined
  return {
    id,
    email,
    name: typeof fullName === "string" && fullName.trim() ? fullName.trim() : null,
  }
}

/**
 * The signed-in user for pages, layouts and Server Actions.
 *
 * Verifies the access token locally (`getClaims()`: signature against the
 * project's asymmetric JWKS, plus expiry) instead of asking Supabase Auth
 * again. That is safe only because `src/proxy.ts` already called `getUser()` —
 * the revocation-aware check — on this same request: every page and every
 * Server Action (they post to the page's URL) passes through it. It saved one
 * Auth round trip, ~300 ms from a remote region, on every navigation
 * (PERFORMANCE_AUDIT.md §12).
 *
 * A path the proxy does not gate (`/api/*`, public pages) must use
 * `getVerifiedSessionUser()` instead.
 *
 * `cache()` dedupes it across a single render pass.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  if (error || !data) return null
  const { sub, email, user_metadata: metadata } = data.claims
  return typeof sub === "string" ? toSessionUser(sub, email, metadata) : null
})

/**
 * The signed-in user, checked against Supabase Auth (sees revoked sessions).
 * For request paths the proxy does not gate, such as Route Handlers under `/api`.
 */
export const getVerifiedSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user ? toSessionUser(user.id, user.email, user.user_metadata) : null
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
