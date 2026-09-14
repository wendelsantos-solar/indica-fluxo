import "server-only"

import type { SupabaseClient, User } from "@supabase/supabase-js"

import { createAdminClient } from "@/lib/supabase/admin"

import { DEMO_PASSWORD } from "./blueprint"

/**
 * Demo logins are provisioned through the Supabase Auth Admin API rather than
 * by writing to `auth.users` directly, so the accounts behave exactly like real
 * sign-ups — including the `handle_new_user` trigger that creates the profile
 * and claims pending affiliate rows.
 *
 * This is a legitimate admin call site (CLAUDE.md, "Supabase security"): there
 * is no user session at seed time, and creating an auth user is by definition
 * an administrative operation that no RLS policy can express.
 */
async function findByEmail(client: SupabaseClient, email: string): Promise<User | null> {
  const wanted = email.toLowerCase()

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error

    const match = data.users.find((user) => user.email?.toLowerCase() === wanted)
    if (match) return match
    if (data.users.length < 200) return null
  }

  return null
}

/** Idempotent: re-running the seed reuses the account and resets its password. */
export async function ensureUser(email: string, fullName: string): Promise<string> {
  const client = createAdminClient()

  const { data, error } = await client.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })

  if (!error && data.user) return data.user.id

  const existing = await findByEmail(client, email)
  if (!existing) throw error ?? new Error(`Could not provision the demo login for ${email}.`)

  const { error: updateError } = await client.auth.admin.updateUserById(existing.id, {
    password: DEMO_PASSWORD,
    user_metadata: { full_name: fullName },
  })
  if (updateError) throw updateError

  return existing.id
}

export async function deleteUsers(emails: string[]): Promise<number> {
  const client = createAdminClient()
  let removed = 0

  for (const email of emails) {
    const user = await findByEmail(client, email)
    if (!user) continue

    const { error } = await client.auth.admin.deleteUser(user.id)
    if (error) throw error
    removed += 1
  }

  return removed
}
