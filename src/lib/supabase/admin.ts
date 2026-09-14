import "server-only"

import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import type { SupabaseClient } from "@supabase/supabase-js"

import { clientEnv } from "@/lib/env/client"
import { requireSupabaseSecretKey } from "@/lib/env/server"

/**
 * Admin client. Authenticates with `SUPABASE_SECRET_KEY` (`sb_secret_*`) and
 * therefore **BYPASSES RLS**.
 *
 * Rules:
 * - Never import this from a Client Component or from anything reachable by the
 *   browser bundle. `server-only` enforces that at build time.
 * - Never use it because writing a policy is inconvenient. If the operation
 *   belongs to the signed-in user, use `./server` and fix the RLS policy.
 * - Legitimate uses are administrative operations with no user session at all:
 *   Auth Admin calls (creating or deleting a user), and maintenance scripts.
 *   Direct SQL that bypasses RLS goes through Drizzle (`DATABASE_URL`,
 *   `src/server/db`), not through this client.
 *
 * Call sites today: `src/server/db/seed/auth.ts` only (provisioning demo
 * logins — there is no session at seed time and no RLS policy can express
 * "create an auth user"). Add another only with a comment saying why the
 * operation cannot run under RLS.
 */
let cached: SupabaseClient | null = null

export function createAdminClient(): SupabaseClient {
  if (cached) return cached

  const env = clientEnv()

  cached = createSupabaseClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    requireSupabaseSecretKey(),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  )

  return cached
}
