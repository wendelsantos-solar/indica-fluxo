/**
 * Payouts against reversals, portal link ownership and RLS isolation, against
 * Postgres. Services run as the app role (`withUser`) in their own
 * transactions, so fixtures are committed and removed in `afterAll`. Opt-in:
 *
 *   RUN_DB_TESTS=1 pnpm exec vitest run src/server/services/__tests__/ledger-portal.db.test.ts
 */
import { config } from "dotenv"
import { eq, inArray, sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/server/services/invite-mail", () => ({
  sendInviteEmail: async () => ({ emailSent: false, skipped: "notConfigured", inviteUrl: "", loginUrl: "" }),
  inviteLinksFor: () => ({ inviteUrl: "", loginUrl: "" }),
}))
config({ path: ".env.local", quiet: true })

const RUN = process.env.RUN_DB_TESTS === "1"

const { db, withUser } = await import("@/server/db")
const schema = await import("@/server/db/schema")
const { createFixtures, errorCode } = await import("./db-fixtures")
const { cancelPayoutBatch, createPayoutBatch, markBatchPaid } = await import("../payouts")
const { deleteReferralLink, renameReferralLink } = await import("../portal")
const { createReferralLink } = await import("../affiliates")

const f = createFixtures("pay")

const period = { periodStart: new Date("2026-09-01T00:00:00Z"), periodEnd: new Date("2026-09-30T00:00:00Z") }

async function statuses(ids: string[]) {
  const rows = await db
    .select({ id: schema.commissions.id, status: schema.commissions.status })
    .from(schema.commissions)
    .where(inArray(schema.commissions.id, ids))
  return Object.fromEntries(rows.map((row) => [row.id, row.status]))
}

/** What the billing webhook does to a fully refunded commission. */
async function reverse(commissionId: string) {
  await db.update(schema.commissions).set({ status: "reversed", reversedAt: new Date() }).where(eq(schema.commissions.id, commissionId))
}

describe.runIf(RUN)("ledger, portal and RLS against Postgres", () => {
  afterAll(async () => {
    await f.cleanup()
  }, 60_000)

  describe("payouts never pay or release a reversed commission", () => {
    let owner: { id: string }
    let ws: string
    let testProgram: string
    let liveProgram: string

    beforeAll(async () => {
      owner = await f.user()
      ws = await f.workspace(owner.id, "growth")
      testProgram = await f.program(ws, { environment: "test" })
      liveProgram = await f.program(ws, { environment: "live" })
    }, 60_000)

    it("mark paid leaves a reversed commission reversed, and the item amount excludes it", async () => {
      const [p] = await f.affiliates(ws, testProgram, 1)
      const kept = await f.commission(ws, testProgram, p!.id, 1000)
      const refunded = await f.commission(ws, testProgram, p!.id, 500)

      const batch = await createPayoutBatch(owner.id, ws, { environment: "test", currency: "BRL", participationIds: [p!.id], ...period })
      expect(batch.totalAmountMinor).toBe(1500)

      await reverse(refunded)
      await markBatchPaid(owner.id, ws, batch.id, "REF-1")

      expect(await statuses([kept, refunded])).toEqual({ [kept]: "paid", [refunded]: "reversed" })
      const [item] = await db.select().from(schema.payoutItems).where(eq(schema.payoutItems.payoutBatchId, batch.id))
      expect(item).toMatchObject({ amountMinor: 1000, status: "paid" })
      const [row] = await db.select().from(schema.payoutBatches).where(eq(schema.payoutBatches.id, batch.id))
      expect(row).toMatchObject({ totalAmountMinor: 1000, status: "paid", environment: "test" })
    }, 60_000)

    it("cancel returns the other commissions to available and does not resurrect a reversed one", async () => {
      const [p] = await f.affiliates(ws, testProgram, 1)
      const kept = await f.commission(ws, testProgram, p!.id, 700)
      const refunded = await f.commission(ws, testProgram, p!.id, 300)

      const batch = await createPayoutBatch(owner.id, ws, { environment: "test", currency: "BRL", participationIds: [p!.id], ...period })
      await reverse(refunded)
      await cancelPayoutBatch(owner.id, ws, batch.id)

      expect(await statuses([kept, refunded])).toEqual({ [kept]: "available", [refunded]: "reversed" })
      // Paying it afterwards is refused, and so is cancelling twice.
      expect(await errorCode(markBatchPaid(owner.id, ws, batch.id))).toBe("conflict")
      expect(await errorCode(cancelPayoutBatch(owner.id, ws, batch.id))).toBe("conflict")
    }, 60_000)

    it("a batch whose every commission was reversed cannot be marked paid", async () => {
      const [p] = await f.affiliates(ws, testProgram, 1)
      const refunded = await f.commission(ws, testProgram, p!.id, 900)
      const batch = await createPayoutBatch(owner.id, ws, { environment: "test", currency: "BRL", participationIds: [p!.id], ...period })
      await reverse(refunded)
      const key = await markBatchPaid(owner.id, ws, batch.id).catch((e: { messageKey?: string }) => e.messageKey)
      expect(key).toBe("batchFullyReversed")
      expect(await statuses([refunded])).toEqual({ [refunded]: "reversed" })
    }, 60_000)

    it("batches are per environment: a live batch never claims test commissions", async () => {
      const [testP] = await f.affiliates(ws, testProgram, 1)
      const [liveP] = await f.affiliates(ws, liveProgram, 1)
      await f.commission(ws, testProgram, testP!.id, 400)
      const live = await f.commission(ws, liveProgram, liveP!.id, 600)

      expect(
        await errorCode(createPayoutBatch(owner.id, ws, { environment: "live", currency: "BRL", participationIds: [testP!.id], ...period })),
      ).toBe("conflict")
      const batch = await createPayoutBatch(owner.id, ws, { environment: "live", currency: "BRL", participationIds: [liveP!.id], ...period })
      expect(batch.totalAmountMinor).toBe(600)
      expect(await statuses([live])).toEqual({ [live]: "approved" })
    }, 60_000)
  })

  describe("portal links belong to the signed-in affiliate", () => {
    it("an admin who is also an affiliate cannot rename, delete or add links on someone else's participation", async () => {
      const owner = await f.user()
      const adminAffiliate = await f.user()
      const other = await f.user()
      const ws = await f.workspace(owner.id, "growth")
      await f.member(ws, adminAffiliate.id, "admin")
      const programId = await f.program(ws)
      await f.linkedAffiliate(ws, programId, adminAffiliate.id)
      const theirs = await f.linkedAffiliate(ws, programId, other.id)

      const link = await createReferralLink(other.id, theirs.participationId, {
        name: "Newsletter",
        destinationUrl: "https://example.com/",
      })

      expect(await errorCode(renameReferralLink(adminAffiliate.id, link.id, "Hijacked"))).toBe("not_found")
      expect(await errorCode(deleteReferralLink(adminAffiliate.id, link.id))).toBe("not_found")
      expect(
        await errorCode(createReferralLink(adminAffiliate.id, theirs.participationId, { name: "Mine now", destinationUrl: "https://example.com/" })),
      ).toBe("not_found")

      await renameReferralLink(other.id, link.id, "Newsletter 2")
      const [row] = await db.select({ name: schema.referralLinks.name }).from(schema.referralLinks).where(eq(schema.referralLinks.id, link.id))
      expect(row?.name).toBe("Newsletter 2")
      await deleteReferralLink(other.id, link.id)
    }, 60_000)

    it("a suspended participation cannot create links", async () => {
      const owner = await f.user()
      const partner = await f.user()
      const ws = await f.workspace(owner.id, "growth")
      const programId = await f.program(ws)
      const { participationId } = await f.linkedAffiliate(ws, programId, partner.id)
      await db.update(schema.programAffiliates).set({ status: "suspended" }).where(eq(schema.programAffiliates.id, participationId))

      const key = await createReferralLink(partner.id, participationId, { name: "Blog", destinationUrl: "https://example.com/" }).catch(
        (e: { messageKey?: string }) => e.messageKey,
      )
      expect(key).toBe("participationInactive")
    }, 60_000)
  })

  describe("RLS isolation", () => {
    it("affiliate A reads none of affiliate B's commissions, links or payout items", async () => {
      const owner = await f.user()
      const a = await f.user()
      const b = await f.user()
      const ws = await f.workspace(owner.id, "growth")
      const programId = await f.program(ws)
      const pa = await f.linkedAffiliate(ws, programId, a.id)
      const pb = await f.linkedAffiliate(ws, programId, b.id)
      await f.commission(ws, programId, pa.participationId, 100)
      await f.commission(ws, programId, pb.participationId, 200)
      await createReferralLink(b.id, pb.participationId, { name: "B link", destinationUrl: "https://example.com/" })
      await createPayoutBatch(owner.id, ws, {
        environment: "test",
        currency: "BRL",
        participationIds: [pa.participationId, pb.participationId],
        ...period,
      })

      const seenBy = (userId: string) =>
        withUser(userId, async (tx) => ({
          commissions: (await tx.select({ p: schema.commissions.programAffiliateId }).from(schema.commissions)).map((r) => r.p),
          links: (await tx.select({ p: schema.referralLinks.programAffiliateId }).from(schema.referralLinks)).map((r) => r.p),
          items: (await tx.select({ p: schema.payoutItems.programAffiliateId }).from(schema.payoutItems)).map((r) => r.p),
          affiliates: (await tx.select({ id: schema.affiliates.id }).from(schema.affiliates)).map((r) => r.id),
        }))

      const seenByA = await seenBy(a.id)
      expect(seenByA.commissions).toEqual([pa.participationId])
      expect(seenByA.links).toEqual([])
      expect(seenByA.items).toEqual([pa.participationId])
      expect(seenByA.affiliates).not.toContain(pb.affiliateId)

      const seenByB = await seenBy(b.id)
      expect(seenByB.commissions).toEqual([pb.participationId])
      expect(seenByB.links).toEqual([pb.participationId])
    }, 60_000)

    it("a member of workspace A reads nothing of workspace B", async () => {
      const ownerA = await f.user()
      const ownerB = await f.user()
      const wsA = await f.workspace(ownerA.id, "growth")
      const wsB = await f.workspace(ownerB.id, "growth")
      const programB = await f.program(wsB)
      const [pB] = await f.affiliates(wsB, programB, 1)
      await f.commission(wsB, programB, pB!.id, 100)

      const seen = await withUser(ownerA.id, async (tx) => ({
        workspaces: (await tx.select({ id: schema.workspaces.id }).from(schema.workspaces)).map((r) => r.id),
        programs: await tx.select({ id: schema.programs.id }).from(schema.programs).where(eq(schema.programs.workspaceId, wsB)),
        commissions: await tx.select({ id: schema.commissions.id }).from(schema.commissions).where(eq(schema.commissions.workspaceId, wsB)),
        affiliates: await tx.select({ id: schema.affiliates.id }).from(schema.affiliates).where(eq(schema.affiliates.workspaceId, wsB)),
        subscription: await tx
          .select({ id: schema.workspaceSubscriptions.id })
          .from(schema.workspaceSubscriptions)
          .where(eq(schema.workspaceSubscriptions.workspaceId, wsB)),
      }))
      expect(seen.workspaces).toContain(wsA)
      expect(seen.workspaces).not.toContain(wsB)
      expect(seen).toMatchObject({ programs: [], commissions: [], affiliates: [], subscription: [] })
    }, 60_000)

    it("the Data API role (`authenticated`) is denied on programs and commissions", async () => {
      const owner = await f.user()
      await f.workspace(owner.id, "growth")
      const claims = JSON.stringify({ sub: owner.id, role: "authenticated" })

      for (const table of ["programs", "commissions", "workspace_subscriptions"]) {
        const outcome = await db
          .transaction(async (tx) => {
            await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`)
            await tx.execute(sql`select set_config('role', 'authenticated', true)`)
            await tx.execute(sql`select 1 from ${sql.identifier(table)} limit 1`)
            return "allowed"
          })
          .catch((error: { cause?: { code?: string }; code?: string }) => error.cause?.code ?? error.code)
        expect(outcome, table).toBe("42501")
      }
    }, 60_000)
  })
})
