/**
 * Server-side data latency of one founder dashboard navigation, through the
 * app's own `@/server/db` module — whatever driver and pool settings it uses.
 * Unlike bench-dashboard.ts it does not inject a pool, so it compares driver or
 * pool changes honestly: run it before and after, on the same network.
 *
 *   pnpm perf:navigation [workspace-slug] [iterations]
 *
 * Read-only: every statement is a SELECT under `withUser()` (RLS applies).
 * Does not include Supabase Auth or React rendering.
 *
 * Run it against a development database, never production.
 */
import { config } from "dotenv"

config({ path: ".env.local", quiet: true })
config({ path: ".env", quiet: true })

const slug = process.argv[2] ?? "acme"
const iterations = Number(process.argv[3] ?? 10)

async function main() {
  const { and, eq } = await import("drizzle-orm")
  const { db } = await import("@/server/db")
  const { workspaceMembers, workspaces } = await import("@/server/db/schema")
  const requests = await import("./dashboard-requests")

  const [owner] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaces.slug, slug), eq(workspaceMembers.role, "owner")))
    .limit(1)
  if (!owner) throw new Error(`No owner found for workspace "${slug}".`)

  const scenarios: Record<string, () => Promise<unknown>> = {
    "layout (shell)": () => requests.loadDashboardLayout(owner.userId, slug),
    "overview page": () => requests.loadOverview(owner.userId, slug),
    "layout + overview (one navigation)": () => requests.loadNavigation(owner.userId, slug),
  }

  const at = (times: number[], q: number) =>
    [...times].sort((a, b) => a - b)[Math.min(times.length - 1, Math.floor(times.length * q))]!

  for (const [name, run] of Object.entries(scenarios)) {
    await run() // warm the pool and the plans
    const times: number[] = []
    for (let i = 0; i < iterations; i += 1) {
      const start = performance.now()
      await run()
      times.push(performance.now() - start)
    }
    console.log(`${name} (n=${iterations}) p50=${at(times, 0.5).toFixed(0)}ms p95=${at(times, 0.95).toFixed(0)}ms`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
