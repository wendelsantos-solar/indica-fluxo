/**
 * Acquisition → activation → paid, by first-touch channel and landing page.
 *
 *   pnpm seo:funnel              # workspaces created in the last 90 days
 *   SINCE=2026-10-01 pnpm seo:funnel
 *
 * Read-only: one SELECT on the service connection (DATABASE_URL), no writes.
 * It crosses tenants on purpose — it is the operator's view of the product, the
 * same class of access as migrations and the seed — and prints counts only, never
 * a workspace name, slug or anything personal.
 *
 * Every milestone is a fact the product already stores; nothing here depends on
 * a client-side analytics script (SEO_STRATEGY.md §7):
 *
 *   workspace          the founder signed up and created a workspace
 *   program            a program exists
 *   sandbox            a commission exists on a TEST program (simulated or test-mode)
 *   tracker            a real click was recorded (simulated `v_sim…` visitors excluded)
 *   first_commission   a commission exists on a LIVE program
 *   paid               the workspace is on a paid plan (active, trialing or in grace)
 *
 * `acquisition` is NULL for workspaces created before migration 0017 or by a
 * visitor whose first touch was not kept (cookie cleared, >90 days): reported
 * as `unknown`, never folded into `direct`.
 */
import { config } from "dotenv"

config({ path: ".env.local", quiet: true })
config({ path: ".env", quiet: true })

import postgres from "postgres"

const url = process.env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is required.")

const since = process.env.SINCE ? new Date(process.env.SINCE) : new Date(Date.now() - 90 * 86_400_000)
if (Number.isNaN(since.getTime())) throw new Error(`SINCE is not a date: ${process.env.SINCE}`)

const sql = postgres(url, { max: 1, prepare: false })

async function main() {
  const rows = await sql`
    with w as (
      select id,
             coalesce(acquisition ->> 'channel', 'unknown') as channel,
             coalesce(acquisition ->> 'landing', '-') as landing
        from public.workspaces
       where created_at >= ${since}
    )
    select channel,
           landing,
           count(*)::int as workspace,
           count(*) filter (where exists (
             select 1 from public.programs p where p.workspace_id = w.id
           ))::int as program,
           count(*) filter (where exists (
             select 1 from public.commissions c join public.programs p on p.id = c.program_id
              where c.workspace_id = w.id and p.environment = 'test'
           ))::int as sandbox,
           count(*) filter (where exists (
             select 1 from public.referral_clicks rc join public.programs p on p.id = rc.program_id
              where p.workspace_id = w.id and rc.visitor_id not like 'v_sim%'
           ))::int as tracker,
           count(*) filter (where exists (
             select 1 from public.commissions c join public.programs p on p.id = c.program_id
              where c.workspace_id = w.id and p.environment = 'live' and c.reversal_of_commission_id is null
           ))::int as first_commission,
           count(*) filter (where exists (
             select 1 from public.workspace_subscriptions s
              where s.workspace_id = w.id and s.plan <> 'sandbox' and s.status in ('active', 'trialing', 'past_due')
           ))::int as paid
      from w
     group by channel, landing
     order by workspace desc, channel, landing
  `

  console.log(`Workspaces created since ${since.toISOString().slice(0, 10)}, by first touch:\n`)
  console.table(rows)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => sql.end())
