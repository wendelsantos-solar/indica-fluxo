import "server-only"

import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

import { clientEnv } from "@/lib/env/client"

/**
 * Session-scoped server client. This is what app code should use.
 *
 * Running on the server does NOT mean using the secret key: this client uses
 * the same publishable key as the browser plus the request's auth cookies, so
 * it stays subject to RLS and `auth.uid()`. Reach for `./admin` only for the
 * rare operation that must legitimately bypass RLS.
 */
export async function createClient() {
  const env = clientEnv()
  const cookieStore = await cookies()

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Called from a Server Component: the middleware refreshes instead.
          }
        },
      },
    },
  )
}
