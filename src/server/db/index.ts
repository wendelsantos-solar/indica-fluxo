import "server-only"

import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { env } from "@/lib/env/server"

import * as schema from "./schema"

declare global {
  var __dbPool: ReturnType<typeof postgres> | undefined
}

function pool() {
  if (!globalThis.__dbPool) {
    globalThis.__dbPool = postgres(env().DATABASE_URL, {
      max: process.env.NODE_ENV === "production" ? 10 : 4,
      idle_timeout: 20,
      prepare: false,
    })
  }
  return globalThis.__dbPool
}

/**
 * Service-level connection. This role BYPASSES RLS.
 *
 * Only three call sites may use it directly, each documented in
 * ARCHITECTURE.md §2: anonymous tracking ingest, provider-authenticated
 * webhooks, and the development seed. Everything else must go through
 * `withUser()`, which downgrades to the `authenticated` role so that Postgres
 * policies — not application code — are the boundary.
 */
let instance: PostgresJsDatabase<typeof schema> | null = null

function getDb(): PostgresJsDatabase<typeof schema> {
  if (!instance) instance = drizzle(pool(), { schema })
  return instance
}

/**
 * Lazily constructed behind a proxy so that importing this module never reads
 * the environment. `next build` collects page data by importing route modules;
 * without this, a production build would demand real database credentials.
 */
export const db: PostgresJsDatabase<typeof schema> = new Proxy(
  {} as PostgresJsDatabase<typeof schema>,
  {
    get(_target, property, receiver) {
      const target = getDb() as unknown as Record<string | symbol, unknown>
      const value = Reflect.get(target, property, receiver)
      return typeof value === "function" ? value.bind(target) : value
    },
  },
)

export type Database = typeof db
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0]
export type DbClient = Database | Transaction

/**
 * Runs `fn` inside a transaction impersonating the Supabase `authenticated`
 * role with `auth.uid()` bound to `userId`, so every statement is filtered by
 * the same RLS policies that protect the PostgREST surface.
 */
export async function withUser<T>(
  userId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const claims = JSON.stringify({ sub: userId, role: "authenticated" })
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`)
    await tx.execute(sql`select set_config('role', 'authenticated', true)`)
    return fn(tx)
  })
}

/** Anonymous (unauthenticated) RLS context — used by public tracking reads. */
export async function withAnon<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('request.jwt.claims', '{"role":"anon"}', true)`)
    await tx.execute(sql`select set_config('role', 'anon', true)`)
    return fn(tx)
  })
}

export { schema }
