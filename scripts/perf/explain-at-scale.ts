/**
 * Query plans at production-like volume, without keeping any of the volume.
 *
 *   pnpm perf:explain            # SCALE_CLICKS=300000 SCALE_PAYMENTS=30000 by default
 *
 * Everything happens inside ONE transaction that is always rolled back:
 *   1. synthetic clicks, customers, payments, commissions and reversals are
 *      inserted into the `acme` demo workspace;
 *   2. the real repositories run as the workspace owner under RLS
 *      (`indica_app` + JWT claims, exactly like `withUser()`), their SQL is
 *      captured and re-run with EXPLAIN (ANALYZE, BUFFERS);
 *   3. ingest-path lookups run on the service connection;
 *   4. candidate indexes are created (still inside the transaction) and the
 *      affected queries are measured again.
 *
 * While it runs, the new rows hold locks on the tables it writes and the
 * candidate indexes block writes to their tables — run it against a
 * development database only, never production. `ANALYZE` runs after the
 * rollback so planner statistics do not keep the synthetic row counts.
 */
import { config } from "dotenv"

config({ path: ".env.local", quiet: true })
config({ path: ".env", quiet: true })

import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import type { DbClient } from "@/server/db"

if (process.env.NODE_ENV === "production") throw new Error("Refusing to run against NODE_ENV=production.")

const CLICKS = Number(process.env.SCALE_CLICKS ?? 300_000)
const PAYMENTS = Number(process.env.SCALE_PAYMENTS ?? 30_000)
const CUSTOMERS = Math.max(1, Math.floor(PAYMENTS / 3))

let captured: { query: string; params: unknown[] }[] | null = null
const client = postgres(process.env.DATABASE_URL!, {
  max: 1,
  prepare: false,
  debug: (_connection, query, params) => {
    captured?.push({ query, params: params as unknown[] })
  },
})

class Rollback extends Error {}

interface PlanNode {
  "Node Type": string
  "Relation Name"?: string
  "Index Name"?: string
  "Actual Rows"?: number
  "Actual Loops"?: number
  Plans?: PlanNode[]
}

function describe(node: PlanNode, acc: Set<string>): void {
  const rows = (node["Actual Rows"] ?? 0) * (node["Actual Loops"] ?? 1)
  if (node["Node Type"] === "Seq Scan" && node["Relation Name"]) acc.add(`SeqScan(${node["Relation Name"]}:${rows})`)
  if (node["Index Name"]) acc.add(`${node["Node Type"].replace(/ /g, "")}(${node["Index Name"]})`)
  if (node["Node Type"] === "Sort") acc.add(`Sort(${rows})`)
  for (const child of node.Plans ?? []) describe(child, acc)
}

async function main() {
  const analytics = await import("@/server/repositories/analytics")
  const { listCommissions } = await import("@/server/repositories/commissions")
  const { listAffiliates } = await import("@/server/repositories/affiliates")
  const results: Record<string, { ms: number; statements: number; plan: string }> = {}

  try {
    await client.begin(async (tx) => {
      await tx`set local statement_timeout = '300s'`
      // A postgres.js transaction has `unsafe` but not the pool's `options`,
      // which drizzle reads to install its type parsers.
      const d = drizzle(Object.assign(tx, { options: client.options }) as unknown as postgres.Sql) as unknown as DbClient

      const [workspace] = await tx<{ id: string }[]>`select id from workspaces where slug = 'acme'`
      if (!workspace) throw new Error("Seed the demo workspace first (pnpm db:seed).")
      const ws = workspace.id
      const [owner] = await tx<{ user_id: string }[]>`
        select user_id from workspace_members where workspace_id = ${ws} and role = 'owner' limit 1`
      const [envRow] = await tx<{ environment: "test" | "live" }[]>`
        select environment from programs where workspace_id = ${ws} order by (environment = 'live') desc limit 1`
      const environment = envRow!.environment
      const claims = JSON.stringify({ sub: owner!.user_id, role: "authenticated" })

      // ---- 1. synthetic volume -------------------------------------------
      let t = performance.now()
      await tx`create temp table syn_pa on commit drop as
        select pa.id, pa.program_id, p.environment, (row_number() over (order by pa.id) - 1)::int as rn
          from program_affiliates pa join programs p on p.id = pa.program_id
         where p.workspace_id = ${ws}`
      const [{ k }] = await tx<{ k: number }[]>`select count(*)::int as k from syn_pa`
      await tx`insert into referral_clicks (program_id, program_affiliate_id, visitor_id, landing_url, occurred_at)
        select s.program_id, s.id, 'v_syn' || g, 'https://acme.example/?ref=syn',
               now() - ((g::bigint * 7919) % (90 * 24 * 60)) * interval '1 minute'
          from generate_series(1, ${CLICKS}::int) g join syn_pa s on s.rn = g % ${k}::int`
      await tx`create temp table syn_cust on commit drop as
        select gen_random_uuid() as id, s.environment, s.id as pa_id, s.program_id, g,
               (row_number() over () - 1)::int as rn
          from generate_series(1, ${CUSTOMERS}::int) g join syn_pa s on s.rn = g % ${k}::int`
      await tx`insert into customers (id, workspace_id, environment, provider, external_id, provider_customer_id, email_hash)
        select id, ${ws}, environment, 'stripe', 'syn_' || g, 'cus_syn' || g, md5('syn' || g) from syn_cust`
      await tx`create temp table syn_tx on commit drop as
        select gen_random_uuid() as id, c.id as customer_id, c.environment, c.pa_id, c.program_id, gs.g,
               now() - ((gs.g::bigint * 104729) % (180 * 24 * 60)) * interval '1 minute' as occurred_at
          from generate_series(1, ${PAYMENTS}::int) as gs(g) join syn_cust c on c.rn = gs.g % ${CUSTOMERS}::int`
      await tx`insert into transactions (id, workspace_id, customer_id, provider, provider_transaction_id, type, environment, currency, gross_amount_minor, occurred_at)
        select id, ${ws}, customer_id, 'stripe', 'pi_syn' || g, 'payment', environment, 'BRL', 4900, occurred_at from syn_tx`
      await tx`insert into commissions (workspace_id, program_id, program_affiliate_id, customer_id, transaction_id, currency, base_amount_minor, commission_rate, commission_amount_minor, status, eligible_at, created_at)
        select ${ws}, program_id, pa_id, customer_id, id, 'BRL', 4900, 3000, 1470,
               (array['pending','available','approved','paid','paid','paid'])[1 + g % 6]::commission_status,
               occurred_at + interval '30 days', occurred_at
          from syn_tx`
      await tx`insert into commissions (workspace_id, program_id, program_affiliate_id, customer_id, transaction_id, currency, base_amount_minor, commission_rate, commission_amount_minor, status, eligible_at, reversal_of_commission_id, created_at)
        select c.workspace_id, c.program_id, c.program_affiliate_id, c.customer_id, c.transaction_id, c.currency,
               -c.base_amount_minor, c.commission_rate, -c.commission_amount_minor, 'reversed', c.eligible_at, c.id,
               c.created_at + interval '5 days'
          from commissions c join syn_tx s on s.id = c.transaction_id
         where s.g % 33 = 0`
      await tx`analyze referral_clicks`
      await tx`analyze customers`
      await tx`analyze transactions`
      await tx`analyze commissions`
      const [volume] = await tx`
        select (select count(*) from referral_clicks)::int as clicks, (select count(*) from commissions)::int as commissions,
               (select count(*) from transactions)::int as transactions, (select count(*) from customers)::int as customers`
      console.log(`volume ready in ${(performance.now() - t).toFixed(0)}ms`, volume, { environment })

      const [reversed] = await tx<{ id: string }[]>`
        select reversal_of_commission_id as id from commissions where reversal_of_commission_id is not null limit 1`
      const now = new Date()
      const period = { days: 30, timeZone: "America/Sao_Paulo", now }

      // ---- measurement ----------------------------------------------------
      async function measure(label: string, run: () => Promise<unknown>, asUser: boolean) {
        if (asUser) {
          await tx`select set_config('request.jwt.claims', ${claims}, true), set_config('role', 'indica_app', true)`
        }
        captured = []
        await run()
        const statements = captured
        captured = null
        let total = 0
        const plan = new Set<string>()
        for (const statement of statements) {
          if (!/^\s*(select|with)/i.test(statement.query) || /set_config/.test(statement.query)) continue
          const [row] = await tx.unsafe(
            `explain (analyze, buffers, format json) ${statement.query}`,
            statement.params as never[],
          )
          const [explained] = (row as unknown as { "QUERY PLAN": [{ "Execution Time": number; Plan: PlanNode }] })["QUERY PLAN"]
          total += explained["Execution Time"]
          describe(explained.Plan, plan)
        }
        if (asUser) await tx`reset role`
        results[label] = { ms: +total.toFixed(1), statements: statements.length, plan: [...plan].join(" ") }
        console.log(`${label.padEnd(58)} exec=${total.toFixed(1)}ms stmts=${statements.length}  ${[...plan].join(" ")}`)
      }

      const userQueries: [string, () => Promise<unknown>][] = [
        ["getDashboardOverview", () => analytics.getDashboardOverview(d, ws, environment, period)],
        ["getRevenueSeries", () => analytics.getRevenueSeries(d, ws, environment, "BRL", period)],
        ["getConversionFunnel", () => analytics.getConversionFunnel(d, ws, environment, period)],
        ["getTopAffiliates", () => analytics.getTopAffiliates(d, ws, environment)],
        ["listConversions page 1", () => analytics.listConversions(d, { workspaceId: ws, environment, limit: 50 })],
        ["listCommissions page 1", () => listCommissions(d, { workspaceId: ws, environment, limit: 50 })],
        ["listAffiliates page 1", () => listAffiliates(d, { workspaceId: ws, environment, limit: 25 })],
        [
          "listAffiliates sort=commission",
          () =>
            listAffiliates(d, { workspaceId: ws, environment, limit: 25, sort: { field: "commission", dir: "desc" } }),
        ],
        [
          "integration health: last click",
          () =>
            tx`select max(rc.occurred_at) from referral_clicks rc join programs p on p.id = rc.program_id
                where p.workspace_id = ${ws} and rc.visitor_id not like 'v_sim%'`,
        ],
        [
          "clicks in 30 days (RLS)",
          () =>
            tx`select count(*) from referral_clicks rc join programs p on p.id = rc.program_id
                where p.workspace_id = ${ws} and p.environment = ${environment} and rc.occurred_at >= now() - interval '30 days'`,
        ],
      ]
      for (const [label, run] of userQueries) await measure(label, run, true)

      await measure(
        "clicks in 30 days (service connection, no RLS)",
        () =>
          tx`select count(*) from referral_clicks rc join programs p on p.id = rc.program_id
              where p.workspace_id = ${ws} and p.environment = ${environment} and rc.occurred_at >= now() - interval '30 days'`,
        false,
      )

      const ingest: [string, () => Promise<unknown>][] = [
        [
          "ingest: reversals of a commission",
          () =>
            tx`select coalesce(sum(abs(commission_amount_minor)), 0)::bigint from commissions
                where reversal_of_commission_id = ${reversed!.id}`,
        ],
        [
          "ingest: identified customer by e-mail hash",
          () =>
            tx`select id, external_id from customers
                where workspace_id = ${ws} and environment = ${environment} and provider = 'stripe'
                  and email_hash = ${"md5-that-matches-nothing"} and external_id is not null
                  and (provider_customer_id is null or provider_customer_id = 'cus_x') limit 2`,
        ],
      ]
      for (const [label, run] of ingest) await measure(label, run, false)

      // ---- 3b. a policy migration under test -------------------------------
      // RLS_MIGRATION=0013_rls_set_membership applies that migration inside
      // this transaction, proves that every rewritten predicate accepts
      // exactly the rows the old one did — for every user, on every row — and
      // measures the user queries again.
      const migration = process.env.RLS_MIGRATION
      if (migration) {
        const { readFileSync } = await import("node:fs")
        const text = readFileSync(`src/server/db/migrations/${migration}.sql`, "utf8")
        for (const statement of text.split("--> statement-breakpoint")) {
          if (statement.replace(/--.*$/gm, "").trim()) await tx.unsafe(statement)
        }

        const workspaceTables = [
          "programs", "affiliates", "customers", "subscriptions", "transactions",
          "integrations", "api_keys", "payout_batches", "audit_logs", "commissions",
        ]
        const checks: [table: string, before: string, after: string][] = [
          ...workspaceTables.flatMap((table): [string, string, string][] => [
            [table, "public.is_workspace_member(workspace_id)", "workspace_id in (select public.member_workspace_ids())"],
            [
              table,
              "public.has_workspace_role(workspace_id, array['owner','admin'])",
              "workspace_id in (select public.admin_workspace_ids())",
            ],
          ]),
          [
            "program_affiliates",
            "public.is_workspace_member(public.program_workspace(program_id)) or affiliate_id in (select public.current_affiliate_ids())",
            "program_id in (select public.member_program_ids()) or affiliate_id in (select public.current_affiliate_ids())",
          ],
          [
            "program_affiliates",
            "public.has_workspace_role(public.program_workspace(program_id), array['owner','admin'])",
            "program_id in (select public.admin_program_ids())",
          ],
          ...["referral_clicks", "attributions"].map((table): [string, string, string] => [
            table,
            "public.is_workspace_member(public.program_workspace(program_id)) or public.owns_participation(program_affiliate_id)",
            "program_id in (select public.member_program_ids()) or program_affiliate_id in (select public.current_participation_ids())",
          ]),
          [
            "commissions",
            "public.owns_participation(program_affiliate_id)",
            "program_affiliate_id in (select public.current_participation_ids())",
          ],
        ]

        const users = await tx<{ id: string }[]>`
          select user_id as id from workspace_members
          union select user_id from affiliates where user_id is not null
          union select gen_random_uuid()`
        let mismatches = 0
        let accepted = 0
        for (const user of users) {
          await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: user.id, role: "authenticated" })}, true)`
          for (const [table, before, after] of checks) {
            const [row] = await tx.unsafe<{ mismatched: number; accepted: number }[]>(
              `select count(*) filter (where coalesce((${before}), false) <> coalesce((${after}), false))::int as mismatched,
                      count(*) filter (where coalesce((${after}), false))::int as accepted
                 from public.${table}`,
            )
            mismatches += row!.mismatched
            accepted += row!.accepted
            if (row!.mismatched > 0) console.log(`MISMATCH ${table} user=${user.id}: ${row!.mismatched} rows\n  ${before}\n  ${after}`)
          }
        }
        await tx`select set_config('request.jwt.claims', '', true)`
        console.log(
          `policy equivalence: ${users.length} users × ${checks.length} predicates, ${accepted} accepted row-checks, ${mismatches} mismatches`,
        )
        if (mismatches > 0) throw new Error("The rewritten policies do not accept the same rows.")

        for (const [label, run] of userQueries) await measure(`${label} [${migration.slice(0, 4)}]`, run, true)
      }

      // ---- 4. candidate indexes ------------------------------------------
      t = performance.now()
      await tx`create index syn_commissions_reversal_idx on commissions (reversal_of_commission_id) where reversal_of_commission_id is not null`
      await tx`create index syn_customers_email_idx on customers (workspace_id, environment, email_hash) where email_hash is not null`
      await tx`create index syn_commissions_workspace_created_idx on commissions (workspace_id, created_at desc, id)`
      console.log(`candidate indexes built in ${(performance.now() - t).toFixed(0)}ms`)
      for (const [label, run] of ingest) await measure(`${label} [+index]`, run, false)
      await measure("listCommissions page 1 [+index]", userQueries[5]![1], true)

      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }

  console.log("rolled back; refreshing planner statistics")
  await client`analyze referral_clicks`
  await client`analyze customers`
  await client`analyze transactions`
  await client`analyze commissions`
  await client.end()
}

main().catch(async (error) => {
  console.error(error)
  await client.end({ timeout: 1 })
  process.exit(1)
})
