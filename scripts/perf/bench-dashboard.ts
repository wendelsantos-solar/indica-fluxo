/**
 * Server-side data latency of the founder dashboard's heaviest request — the
 * workspace layout plus the overview page — measured against the database in
 * DATABASE_URL, through the same services and repositories the pages call.
 *
 *   pnpm perf:dashboard [workspace-slug] [iterations]
 *
 * Each iteration runs the current code (./dashboard-requests.ts) and the
 * pre-audit code (./dashboard-requests-before.ts) back to back, alternating
 * which goes first, so remote round-trip drift hits both equally.
 *
 * Read-only: every statement is a SELECT under `withUser()` (RLS applies).
 * It cannot measure the Supabase Auth `getUser()` call or React rendering;
 * those need an authenticated browser session. Counts statements by wrapping
 * the pool the app would otherwise create (`globalThis.__dbPool`).
 *
 * Run it against a development database, never production.
 */
import { config } from "dotenv"

config({ path: ".env.local", quiet: true })
config({ path: ".env", quiet: true })

import postgres from "postgres"

let statements = 0
globalThis.__dbPool = postgres(process.env.DATABASE_URL!, {
  max: 10,
  idle_timeout: 20,
  // Mirrors src/server/db/index.ts. BENCH_PREPARE=1 turns the pool option on to
  // show it changes nothing here: Drizzle issues every query through
  // `sql.unsafe()`, which forces unnamed statements (PERFORMANCE_AUDIT.md BE-2).
  prepare: process.env.BENCH_PREPARE === "1",
  debug: () => {
    statements += 1
  },
})

const slug = process.argv[2] ?? "acme"
const iterations = Number(process.argv[3] ?? 15)

interface Sample {
  times: number[]
  statements: number
}

async function main() {
  const { sql } = await import("drizzle-orm")
  const { db } = await import("@/server/db")
  const after = await import("./dashboard-requests")
  const before = await import("./dashboard-requests-before")

  const [owner] = await db.execute<{ user_id: string }>(sql`
    select m.user_id from workspace_members m join workspaces w on w.id = m.workspace_id
     where w.slug = ${slug} and m.role = 'owner' limit 1
  `)
  if (!owner) throw new Error(`No owner found for workspace "${slug}".`)
  const userId = owner.user_id

  const scenarios: Record<string, { before: () => Promise<unknown>; after: () => Promise<unknown> }> = {
    "layout (shell)": {
      before: () => before.loadDashboardLayoutBefore(userId, slug),
      after: () => after.loadDashboardLayout(userId, slug),
    },
    "overview page": {
      before: () => before.loadOverviewBefore(userId, slug),
      after: () => after.loadOverview(userId, slug),
    },
    // Next.js renders a layout and its page concurrently.
    "layout + overview (one navigation)": {
      before: () => before.loadNavigationBefore(userId, slug),
      after: () => after.loadNavigation(userId, slug),
    },
  }

  const measure = async (run: () => Promise<unknown>, sample: Sample) => {
    statements = 0
    const start = performance.now()
    await run()
    sample.times.push(performance.now() - start)
    sample.statements = statements
  }
  const at = (times: number[], q: number) =>
    [...times].sort((a, b) => a - b)[Math.min(times.length - 1, Math.floor(times.length * q))]!

  for (const [name, variants] of Object.entries(scenarios)) {
    await variants.before() // warm the pool and the plans
    await variants.after()
    const b: Sample = { times: [], statements: 0 }
    const a: Sample = { times: [], statements: 0 }
    for (let i = 0; i < iterations; i += 1) {
      if (i % 2 === 0) {
        await measure(variants.before, b)
        await measure(variants.after, a)
      } else {
        await measure(variants.after, a)
        await measure(variants.before, b)
      }
    }
    const line = (label: string, s: Sample) =>
      `  ${label} p50=${at(s.times, 0.5).toFixed(0)}ms p95=${at(s.times, 0.95).toFixed(0)}ms statements=${s.statements}`
    const delta = ((at(a.times, 0.5) - at(b.times, 0.5)) / at(b.times, 0.5)) * 100
    console.log(`${name} (n=${iterations}, interleaved)`)
    console.log(line("before", b))
    console.log(line("after ", a))
    console.log(`  delta p50 ${delta.toFixed(1)}%`)
  }

  await globalThis.__dbPool!.end()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
