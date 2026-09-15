/**
 * Committed fixtures for DB tests that drive real services. Services open
 * their own `withUser()` transactions, so their data cannot live in a
 * rolled-back transaction: everything here is written on the service
 * connection, tracked, and deleted by `cleanup()` in dependency order (the
 * ledger restricts deletes, so cascades alone are not enough).
 *
 * Test-only. Import after `vi.mock("server-only", () => ({}))` and dotenv.
 */
import { sql } from "drizzle-orm"

import type { PlanCode } from "@/lib/plans"
import { db } from "@/server/db"
import * as schema from "@/server/db/schema"

type Environment = "test" | "live"

export function createFixtures(prefix: string) {
  const userIds: string[] = []
  const workspaceIds: string[] = []
  const tag = `${prefix}-${crypto.randomUUID().slice(0, 8)}`
  let counter = 0
  const next = () => `${tag}-${(counter += 1)}`

  /** An auth user with a confirmed address, straight into `auth.users` (the sign-up trigger runs). */
  async function user(): Promise<{ id: string; email: string }> {
    const id = crypto.randomUUID()
    const email = `${next()}@example.test`
    await db.execute(sql`
      insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
      values (${id}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${email}, now(), '{}'::jsonb, now(), now())
    `)
    userIds.push(id)
    return { id, email }
  }

  async function subscribe(
    workspaceId: string,
    subscription: { plan: PlanCode; status?: "active" | "past_due" | "cancelled"; pastDueSince?: Date | null } | null,
  ) {
    await db.delete(schema.workspaceSubscriptions).where(sql`workspace_id = ${workspaceId}`)
    if (!subscription) return
    await db.insert(schema.workspaceSubscriptions).values({
      workspaceId,
      plan: subscription.plan,
      status: subscription.status ?? "active",
      provider: "manual",
      pastDueSince: subscription.pastDueSince ?? null,
    })
  }

  /** A workspace owned by `ownerId`, on `plan` (`null` = Sandbox, no row). */
  async function workspace(ownerId: string, plan: PlanCode | null = null) {
    const slug = next()
    const [row] = await db
      .insert(schema.workspaces)
      .values({ name: slug, slug, defaultCurrency: "BRL" })
      .returning({ id: schema.workspaces.id })
    workspaceIds.push(row!.id)
    await db.insert(schema.workspaceMembers).values({ workspaceId: row!.id, userId: ownerId, role: "owner" })
    if (plan) await subscribe(row!.id, { plan })
    return row!.id
  }

  async function member(workspaceId: string, userId: string, role: "owner" | "admin" | "member" = "member") {
    await db.insert(schema.workspaceMembers).values({ workspaceId, userId, role })
  }

  async function program(
    workspaceId: string,
    options: { environment?: Environment; status?: "draft" | "active" | "paused" | "archived" } = {},
  ) {
    const slug = next()
    const [row] = await db
      .insert(schema.programs)
      .values({
        workspaceId,
        name: slug,
        slug,
        status: options.status ?? "active",
        environment: options.environment ?? "test",
        commissionType: "percentage",
        commissionValue: 3000,
        commissionHoldDays: 0,
        currency: "BRL",
      })
      .returning({ id: schema.programs.id })
    return row!.id
  }

  /** `count` affiliates, each with a participation in `programId`, in one statement each. */
  async function affiliates(
    workspaceId: string,
    programId: string,
    count: number,
    status: "pending" | "approved" | "rejected" | "suspended" = "approved",
  ) {
    const base = next()
    const rows = await db
      .insert(schema.affiliates)
      .values(
        Array.from({ length: count }, (_, i) => ({
          workspaceId,
          email: `${base}-${i}@example.test`,
          name: `${base}-${i}`,
          status: "active" as const,
        })),
      )
      .returning({ id: schema.affiliates.id })
    const participations = await db
      .insert(schema.programAffiliates)
      .values(rows.map((row, i) => ({ programId, affiliateId: row.id, code: `${base}-${i}`, status })))
      .returning({ id: schema.programAffiliates.id, affiliateId: schema.programAffiliates.affiliateId })
    return participations
  }

  /** One affiliate tied to an account, enrolled in `programId`. */
  async function linkedAffiliate(workspaceId: string, programId: string, userId: string) {
    const code = next()
    const [affiliate] = await db
      .insert(schema.affiliates)
      .values({ workspaceId, userId, email: `${code}@example.test`, name: code, status: "active" })
      .returning({ id: schema.affiliates.id })
    const [participation] = await db
      .insert(schema.programAffiliates)
      .values({ programId, affiliateId: affiliate!.id, code, status: "approved" })
      .returning({ id: schema.programAffiliates.id })
    return { affiliateId: affiliate!.id, participationId: participation!.id }
  }

  /** A payment and its commission, straight into the ledger (status `available` unless given). */
  async function commission(
    workspaceId: string,
    programId: string,
    participationId: string,
    amountMinor: number,
    status: "pending" | "available" | "approved" | "paid" | "reversed" = "available",
  ) {
    const ref = next()
    const [customer] = await db
      .insert(schema.customers)
      .values({ workspaceId, programId, externalId: ref, provider: "stripe" })
      .returning({ id: schema.customers.id })
    const [transaction] = await db
      .insert(schema.transactions)
      .values({
        workspaceId,
        customerId: customer!.id,
        provider: "stripe",
        providerTransactionId: `pi_${ref}`,
        type: "payment",
        currency: "BRL",
        grossAmountMinor: amountMinor * 3,
        occurredAt: new Date(Date.now() - 86_400_000),
      })
      .returning({ id: schema.transactions.id })
    const [row] = await db
      .insert(schema.commissions)
      .values({
        workspaceId,
        programId,
        programAffiliateId: participationId,
        customerId: customer!.id,
        transactionId: transaction!.id,
        currency: "BRL",
        baseAmountMinor: amountMinor * 3,
        commissionRate: 3333,
        commissionAmountMinor: amountMinor,
        status,
        eligibleAt: new Date(Date.now() - 3_600_000),
      })
      .returning({ id: schema.commissions.id })
    return row!.id
  }

  async function cleanup() {
    for (const workspaceId of workspaceIds) {
      await db.transaction(async (tx) => {
        const scope = sql`(${workspaceId}::uuid)`
        await tx.execute(sql`
          delete from payout_item_commissions where payout_item_id in (
            select pi.id from payout_items pi join payout_batches pb on pb.id = pi.payout_batch_id
             where pb.workspace_id in ${scope})`)
        await tx.execute(sql`delete from payout_items where payout_batch_id in (select id from payout_batches where workspace_id in ${scope})`)
        await tx.execute(sql`delete from payout_batches where workspace_id in ${scope}`)
        await tx.execute(sql`delete from commissions where workspace_id in ${scope}`)
        await tx.execute(sql`delete from transactions where workspace_id in ${scope}`)
        await tx.execute(sql`delete from subscriptions where workspace_id in ${scope}`)
        await tx.execute(sql`delete from customers where workspace_id in ${scope}`)
        await tx.execute(sql`delete from attributions where program_id in (select id from programs where workspace_id in ${scope})`)
        await tx.execute(sql`delete from referral_clicks where program_id in (select id from programs where workspace_id in ${scope})`)
        await tx.execute(sql`
          delete from referral_links where program_affiliate_id in (
            select pa.id from program_affiliates pa join programs p on p.id = pa.program_id where p.workspace_id in ${scope})`)
        await tx.execute(sql`delete from program_affiliates where program_id in (select id from programs where workspace_id in ${scope})`)
        await tx.execute(sql`delete from affiliates where workspace_id in ${scope}`)
        await tx.execute(sql`delete from programs where workspace_id in ${scope}`)
        await tx.execute(sql`delete from workspaces where id in ${scope}`)
      })
    }
    if (userIds.length > 0) {
      await db.execute(sql`delete from auth.users where id in (${sql.join(userIds.map((id) => sql`${id}::uuid`), sql`, `)})`)
    }
  }

  return { user, workspace, subscribe, member, program, affiliates, linkedAffiliate, commission, cleanup }
}

/** The typed code of a rejected service call, for `expect(...).rejects`. */
export async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return (error as { code?: string }).code ?? String(error)
  }
  return "resolved"
}
