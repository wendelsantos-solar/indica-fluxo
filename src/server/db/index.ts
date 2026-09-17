import "server-only"

import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import { env } from "@/lib/env/server"

import * as schema from "./schema"

declare global {
  var __dbPool: Pool | undefined
}

/**
 * node-postgres, not postgres.js. Every query here is parameterised, and
 * Drizzle's postgres.js driver sends each one as Parse+Describe, waits, then
 * Bind+Execute: two network round trips per statement. node-postgres sends the
 * whole extended-protocol exchange in one flight — one round trip. Against a
 * remote database that halves every query (PERFORMANCE_AUDIT.md BE-2, §12).
 *
 * `idleTimeoutMillis`: a fresh connection to the pooler costs seconds (TLS,
 * pooler auth), so a long-lived server keeps idle connections for five minutes
 * instead of dropping them after a short pause (BE-3). `keepAlive` stops NAT
 * and pooler middleboxes from silently killing them in between.
 */
function pool() {
  if (!globalThis.__dbPool) {
    globalThis.__dbPool = new Pool({
      connectionString: env().DATABASE_URL,
      max: process.env.NODE_ENV === "production" ? 10 : 4,
      idleTimeoutMillis: 300_000,
      keepAlive: true,
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
let instance: NodePgDatabase<typeof schema> | null = null

function getDb(): NodePgDatabase<typeof schema> {
  if (!instance) instance = drizzle(pool(), { schema })
  return instance
}

/**
 * Lazily constructed behind a proxy so that importing this module never reads
 * the environment. `next build` collects page data by importing route modules;
 * without this, a production build would demand real database credentials.
 */
export const db: NodePgDatabase<typeof schema> = new Proxy(
  {} as NodePgDatabase<typeof schema>,
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
 * Runs `fn` inside a transaction as the application role `indica_app` with
 * `auth.uid()` bound to `userId`, so every statement is filtered by the RLS
 * policies (written `TO authenticated`; `indica_app` is a member of it).
 *
 * Not `authenticated` itself: that role is what the Supabase Data API uses, and
 * it holds no table privileges (migration 0009). The rules the services enforce
 * — plan limits, roles, the append-only ledger — would otherwise be bypassable
 * with a user's session and the publishable key.
 */
export async function withUser<T>(
  userId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const claims = JSON.stringify({ sub: userId, role: "authenticated" })
    // One statement, one round trip: both settings are transaction-local and
    // take effect before `fn` issues its first query. If either fails, the
    // statement fails and the transaction aborts before anything runs.
    await tx.execute(
      sql`select set_config('request.jwt.claims', ${claims}, true), set_config('role', 'indica_app', true)`,
    )
    return fn(tx)
  })
}

export { schema }
