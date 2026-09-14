"use client"

import { createBrowserClient } from "@supabase/ssr"

import { clientEnv } from "@/lib/env/client"

/**
 * Browser client. Uses the publishable key (`sb_publishable_*`) and the user's
 * auth cookie, so every query is filtered by RLS with `auth.uid()` bound to the
 * signed-in user. It must never see `SUPABASE_SECRET_KEY`.
 */
export function createClient() {
  const env = clientEnv()

  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  )
}
