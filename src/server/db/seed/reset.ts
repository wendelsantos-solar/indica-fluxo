import "./bootstrap"
import "server-only"

import { sql } from "drizzle-orm"

import { db } from "@/server/db"

import { assertNotProduction, describeTarget } from "./bootstrap"
import { deleteUsers } from "./auth"
import { DEMO_EMAILS, DEMO_WORKSPACE_SLUGS } from "./blueprint"

/**
 * Removes everything the seed created — and nothing else. Scoped by the demo
 * workspace slugs and the demo e-mail addresses, so pointing this at a database
 * that also holds real data cannot touch that data.
 *
 * Deletion is ordered by hand rather than left to `ON DELETE CASCADE`: the
 * ledger deliberately uses `ON DELETE RESTRICT` towards programs, customers and
 * transactions (DATABASE.md §3), so a blind `DELETE FROM workspaces` would
 * either fail or depend on the order Postgres happens to pick.
 */
export async function resetDemo(): Promise<{ workspaces: number; users: number }> {
  let removed = 0
  for (const slug of DEMO_WORKSPACE_SLUGS) removed += await resetWorkspace(slug)

  // Deleting the auth user cascades to `profiles`.
  const users = await deleteUsers(DEMO_EMAILS)

  return { workspaces: removed, users }
}

async function resetWorkspace(slug: string): Promise<number> {
  return db.transaction(async (tx) => {
    const found = await tx.execute<{ id: string }>(
      sql`select id from workspaces where slug = ${slug}`,
    )
    const ids = found.map((row) => row.id)
    if (ids.length === 0) return 0

    const scope = sql`(select id from workspaces where slug = ${slug})`

    await tx.execute(sql`
      delete from payout_item_commissions
       where payout_item_id in (
         select pi.id from payout_items pi
           join payout_batches pb on pb.id = pi.payout_batch_id
          where pb.workspace_id in ${scope})
    `)
    await tx.execute(sql`
      delete from payout_items
       where payout_batch_id in (
         select id from payout_batches where workspace_id in ${scope})
    `)
    await tx.execute(sql`delete from payout_batches where workspace_id in ${scope}`)
    await tx.execute(sql`delete from commissions where workspace_id in ${scope}`)
    await tx.execute(sql`delete from transactions where workspace_id in ${scope}`)
    await tx.execute(sql`delete from subscriptions where workspace_id in ${scope}`)
    await tx.execute(sql`delete from customers where workspace_id in ${scope}`)
    await tx.execute(sql`
      delete from attributions
       where program_id in (select id from programs where workspace_id in ${scope})
    `)
    await tx.execute(sql`
      delete from referral_clicks
       where program_id in (select id from programs where workspace_id in ${scope})
    `)
    await tx.execute(sql`
      delete from referral_links
       where program_affiliate_id in (
         select pa.id from program_affiliates pa
           join programs p on p.id = pa.program_id
          where p.workspace_id in ${scope})
    `)
    await tx.execute(sql`
      delete from program_affiliates
       where program_id in (select id from programs where workspace_id in ${scope})
    `)
    await tx.execute(sql`delete from affiliates where workspace_id in ${scope}`)
    await tx.execute(sql`delete from programs where workspace_id in ${scope}`)
    await tx.execute(sql`delete from api_keys where workspace_id in ${scope}`)
    await tx.execute(sql`delete from integrations where workspace_id in ${scope}`)
    await tx.execute(sql`delete from audit_logs where workspace_id in ${scope}`)
    await tx.execute(sql`delete from webhook_events where workspace_id in ${scope}`)
    await tx.execute(sql`delete from workspace_invites where workspace_id in ${scope}`)
    await tx.execute(sql`delete from workspace_members where workspace_id in ${scope}`)
    await tx.execute(sql`delete from workspace_subscriptions where workspace_id in ${scope}`)
    await tx.execute(sql`delete from workspaces where slug = ${slug}`)

    return ids.length
  })
}

async function main() {
  assertNotProduction("pnpm db:reset")
  console.log(`Resetting demo data on ${describeTarget()} …`)

  const { workspaces, users } = await resetDemo()
  console.log(`Removed ${workspaces} demo workspace(s) and ${users} demo login(s).`)
  process.exit(0)
}

if (process.argv[1]?.includes("seed/reset")) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
