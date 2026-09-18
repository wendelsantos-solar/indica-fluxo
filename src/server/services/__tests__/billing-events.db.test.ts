/**
 * Refund/dispute matching (T6) and the e-mail fallback (T3) against a real
 * Postgres. Every test runs inside a transaction that is rolled back, so
 * nothing persists. Opt-in, because CI has no database:
 *
 *   RUN_DB_TESTS=1 pnpm exec vitest run src/server/services/__tests__/billing-events.db.test.ts
 */
import { config } from "dotenv"
import { and, eq, inArray } from "drizzle-orm"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
config({ path: ".env.local", quiet: true })

const RUN = process.env.RUN_DB_TESTS === "1"

const { db } = await import("@/server/db")
const schema = await import("@/server/db/schema")
const { handleBillingEvent, ingestVerifiedWebhook, PaymentNotRecordedYetError } = await import("../billing-events")
const { hashEmail } = await import("@/lib/crypto/hash")

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Event = Parameters<typeof handleBillingEvent>[1]

const PAID_AT = new Date("2026-08-01T12:00:00Z")
const NOW = new Date("2026-08-02T12:00:00Z")
const ROLLBACK = new Error("rollback")

/** A workspace with an active 30% BRL program, no hold, and one approved affiliate. */
async function fixture(tx: Tx) {
  const suffix = crypto.randomUUID().slice(0, 8)
  const [ws] = await tx
    .insert(schema.workspaces)
    .values({ name: `T6 ${suffix}`, slug: `t6-${suffix}`, defaultCurrency: "BRL" })
    .returning({ id: schema.workspaces.id })
  const workspaceId = ws!.id
  const [program] = await tx
    .insert(schema.programs)
    .values({
      workspaceId,
      name: "P",
      slug: `p-${suffix}`,
      status: "active",
      commissionType: "percentage",
      commissionValue: 3000,
      commissionHoldDays: 0,
      currency: "BRL",
    })
    .returning({ id: schema.programs.id })
  const [affiliate] = await tx
    .insert(schema.affiliates)
    .values({ workspaceId, email: `aff-${suffix}@example.com`, name: "Aff", status: "active" })
    .returning({ id: schema.affiliates.id })
  const [participation] = await tx
    .insert(schema.programAffiliates)
    .values({ programId: program!.id, affiliateId: affiliate!.id, code: `c${suffix}`, status: "approved" })
    .returning({ id: schema.programAffiliates.id })

  const attribute = (fields: { providerCustomerId?: string; customerExternalId?: string }) =>
    tx.insert(schema.attributions).values({
      programId: program!.id,
      programAffiliateId: participation!.id,
      visitorId: `v_${crypto.randomUUID()}`,
      attributionModel: "last_click",
      attributedAt: new Date("2026-07-01T00:00:00Z"),
      expiresAt: new Date("2026-12-01T00:00:00Z"),
      ...fields,
    })

  const handle = (event: Event) => handleBillingEvent(workspaceId, event, NOW, tx)

  const commissionsOf = async (providerTransactionId: string) => {
    const [payment] = await tx
      .select({ id: schema.transactions.id })
      .from(schema.transactions)
      .where(and(eq(schema.transactions.workspaceId, workspaceId), eq(schema.transactions.providerTransactionId, providerTransactionId)))
    const [original] = await tx.select().from(schema.commissions).where(eq(schema.commissions.transactionId, payment!.id))
    const reversals = await tx
      .select()
      .from(schema.commissions)
      .where(eq(schema.commissions.reversalOfCommissionId, original!.id))
      .orderBy(schema.commissions.createdAt)
    return { original: original!, reversals }
  }

  return { workspaceId, attribute, handle, commissionsOf }
}

const base = { provider: "stripe" as const, providerAccountId: null, occurredAt: PAID_AT, environment: "test" as const }

function payment(
  id: string,
  references: string[],
  customer: string,
  email: string | null = null,
  amountMinor = 4900,
): Extract<Event, { type: "payment.succeeded" }> {
  return {
    ...base,
    type: "payment.succeeded",
    providerEventId: `evt_${id}`,
    rawType: id.startsWith("in_") ? "invoice.paid" : "payment_intent.succeeded",
    providerTransactionId: id,
    providerReferences: references,
    providerCustomerId: customer,
    providerSubscriptionId: null,
    customerEmail: email,
    currency: "BRL",
    amountMinor,
  }
}

function refund(id: string, references: string[], amountMinor: number, isChargeback = false): Event {
  return {
    ...base,
    type: "payment.refunded",
    providerEventId: `evt_${id}`,
    rawType: isChargeback ? "charge.dispute.created" : "refund.created",
    occurredAt: NOW,
    providerTransactionId: id,
    paymentReferences: references,
    providerCustomerId: null,
    currency: "BRL",
    amountMinor,
    isChargeback,
  }
}

function disputeWon(id: string, references: string[]): Event {
  return {
    ...base,
    type: "payment.disputeWon",
    providerEventId: `evt_won_${id}`,
    rawType: "charge.dispute.closed",
    occurredAt: NOW,
    providerDisputeId: id,
    paymentReferences: references,
  }
}

function link(invoice: string, references: string[]): Event {
  return {
    ...base,
    type: "payment.referenced",
    providerEventId: `evt_link_${invoice}`,
    rawType: "invoice_payment.paid",
    providerTransactionId: invoice,
    providerReferences: references,
  }
}

/** Runs `fn` in a transaction that is always rolled back. */
async function inRollback(fn: (tx: Tx) => Promise<void>) {
  await expect(
    db.transaction(async (tx) => {
      await fn(tx)
      throw ROLLBACK
    }),
  ).rejects.toBe(ROLLBACK)
}

describe.runIf(RUN)("billing events against Postgres", () => {
  it("full refund of a one-off PaymentIntent payment reverses the whole commission", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      await f.attribute({ providerCustomerId: "cus_a" })
      await f.handle(payment("pi_a", ["ch_a"], "cus_a"))
      // The refund names the charge only.
      const outcome = await f.handle(refund("re_a", ["ch_a"], 4900))
      expect(outcome.status).toBe("processed")

      const { original, reversals } = await f.commissionsOf("pi_a")
      expect(original.commissionAmountMinor).toBe(1470)
      expect(original.status).toBe("reversed")
      expect(reversals.map((r) => [r.commissionAmountMinor, r.status])).toEqual([[-1470, "reversed"]])
    })
  }, 30_000)

  it("two partial refunds of an invoice payment are two proportional rows; the original keeps its status", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      await f.attribute({ providerCustomerId: "cus_b" })
      await f.handle(payment("in_b", [], "cus_b", null, 3000)) // commission 900
      await f.handle(link("in_b", ["pi_b", "ch_b"]))

      await f.handle(refund("re_b1", ["pi_b", "ch_b"], 1000))
      await f.handle(refund("re_b2", ["pi_b", "ch_b"], 1000))
      // A redelivery of the first refund changes nothing.
      expect(await f.handle(refund("re_b1", ["pi_b", "ch_b"], 1000))).toMatchObject({ detail: "refund already recorded" })

      let { original, reversals } = await f.commissionsOf("in_b")
      expect(original.status).toBe("available")
      expect(reversals.map((r) => [r.commissionAmountMinor, r.status])).toEqual([
        [-300, "available"],
        [-300, "available"],
      ])

      // The last third completes the refund: exact total, everything settles to reversed.
      await f.handle(refund("re_b3", ["pi_b"], 1000))
      ;({ original, reversals } = await f.commissionsOf("in_b"))
      expect(original.status).toBe("reversed")
      expect(reversals.reduce((sum, r) => sum + r.commissionAmountMinor, 0)).toBe(-900)
      expect(reversals.every((r) => r.status === "reversed")).toBe(true)
    })
  }, 30_000)

  it("a dispute on an invoice payment is found through its PaymentIntent, whatever order the link arrived in", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      await f.attribute({ providerCustomerId: "cus_c" })
      await f.handle(link("in_c", ["pi_c", "ch_c"])) // before the invoice payment
      await f.handle(payment("in_c", [], "cus_c"))
      await f.handle(refund("dp_c", ["pi_c", "ch_c"], 4900, true))

      const { original, reversals } = await f.commissionsOf("in_c")
      expect(original.status).toBe("reversed")
      expect(reversals).toHaveLength(1)
      expect(reversals[0]!.commissionAmountMinor).toBe(-1470)

      const [dispute] = await tx
        .select({ type: schema.transactions.type, parent: schema.transactions.providerParentTransactionId })
        .from(schema.transactions)
        .where(and(eq(schema.transactions.workspaceId, f.workspaceId), eq(schema.transactions.providerTransactionId, "dp_c")))
      expect(dispute).toEqual({ type: "chargeback", parent: "in_c" })
    })
  }, 30_000)

  it("a partial dispute on a PaymentIntent payment reverses its share", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      await f.attribute({ providerCustomerId: "cus_d" })
      await f.handle(payment("pi_d", ["ch_d"], "cus_d"))
      await f.handle(refund("dp_d", ["pi_d", "ch_d"], 2450, true))

      const { original, reversals } = await f.commissionsOf("pi_d")
      expect(original.status).toBe("available")
      expect(reversals.map((r) => r.commissionAmountMinor)).toEqual([-735])
    })
  }, 30_000)

  it("never rewrites a paid commission: the reversal is recorded, the original stays paid", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      await f.attribute({ providerCustomerId: "cus_p" })
      await f.handle(payment("pi_p", [], "cus_p"))
      const { original } = await f.commissionsOf("pi_p")
      await tx.update(schema.commissions).set({ status: "paid" }).where(eq(schema.commissions.id, original.id))

      await f.handle(refund("re_p", ["pi_p"], 4900))
      const after = await f.commissionsOf("pi_p")
      expect(after.original.status).toBe("paid")
      expect(after.reversals.map((r) => [r.commissionAmountMinor, r.status])).toEqual([[-1470, "reversed"]])
    })
  }, 30_000)

  describe("won disputes", () => {
    /** The positive commission a won dispute wrote, through its `won_` adjustment. */
    const restorationOf = async (tx: Tx, workspaceId: string, disputeId: string) => {
      const [adjustment] = await tx
        .select({ id: schema.transactions.id, gross: schema.transactions.grossAmountMinor, parent: schema.transactions.providerParentTransactionId })
        .from(schema.transactions)
        .where(and(eq(schema.transactions.workspaceId, workspaceId), eq(schema.transactions.providerTransactionId, `won_${disputeId}`)))
      if (!adjustment) return { adjustment: null, commissions: [] }
      const rows = await tx.select().from(schema.commissions).where(eq(schema.commissions.transactionId, adjustment.id))
      return { adjustment, commissions: rows }
    }

    it("gives back a partial chargeback, pending under the hold, and leaves the chargeback in place", async () => {
      await inRollback(async (tx) => {
        const f = await fixture(tx)
        await f.attribute({ providerCustomerId: "cus_w1" })
        await f.handle(payment("pi_w1", ["ch_w1"], "cus_w1"))
        await f.handle(refund("dp_w1", ["pi_w1", "ch_w1"], 2450, true))

        const outcome = await f.handle(disputeWon("dp_w1", ["pi_w1", "ch_w1"]))
        expect(outcome).toMatchObject({ status: "processed", detail: "restored 735 BRL after a won dispute" })

        const { adjustment, commissions } = await restorationOf(tx, f.workspaceId, "dp_w1")
        expect(adjustment).toMatchObject({ gross: 2450, parent: "pi_w1" })
        expect(commissions.map((c) => [c.commissionAmountMinor, c.status, c.reversalOfCommissionId])).toEqual([[735, "pending", null]])

        const { original, reversals } = await f.commissionsOf("pi_w1")
        expect(original.status).toBe("available")
        expect(reversals.map((r) => r.commissionAmountMinor)).toEqual([-735])
      })
    }, 30_000)

    it("gives back a chargeback that reversed the whole commission", async () => {
      await inRollback(async (tx) => {
        const f = await fixture(tx)
        await f.attribute({ providerCustomerId: "cus_w2" })
        await f.handle(payment("pi_w2", [], "cus_w2"))
        await f.handle(refund("dp_w2", ["pi_w2"], 4900, true))
        expect((await f.commissionsOf("pi_w2")).original.status).toBe("reversed")

        await f.handle(disputeWon("dp_w2", ["pi_w2"]))
        const { commissions } = await restorationOf(tx, f.workspaceId, "dp_w2")
        expect(commissions.map((c) => [c.commissionAmountMinor, c.status])).toEqual([[1470, "pending"]])
      })
    }, 30_000)

    it("restores nothing when the original was paid and the chargeback took nothing back", async () => {
      await inRollback(async (tx) => {
        const f = await fixture(tx)
        await f.attribute({ providerCustomerId: "cus_w3" })
        await f.handle(payment("pi_w3", [], "cus_w3"))
        const { original } = await f.commissionsOf("pi_w3")
        await tx.update(schema.commissions).set({ status: "paid" }).where(eq(schema.commissions.id, original.id))
        await f.handle(refund("dp_w3", ["pi_w3"], 4900, true))

        const outcome = await f.handle(disputeWon("dp_w3", ["pi_w3"]))
        expect(outcome).toMatchObject({ detail: "won dispute recorded; the chargeback took nothing to restore" })
        expect((await restorationOf(tx, f.workspaceId, "dp_w3")).commissions).toEqual([])
      })
    }, 30_000)

    it("is idempotent, and waits for the chargeback when the close arrives first", async () => {
      await inRollback(async (tx) => {
        const f = await fixture(tx)
        await f.attribute({ providerCustomerId: "cus_w4" })
        await f.handle(payment("pi_w4", [], "cus_w4"))

        await expect(f.handle(disputeWon("dp_w4", ["pi_w4"]))).rejects.toBeInstanceOf(PaymentNotRecordedYetError)

        await f.handle(refund("dp_w4", ["pi_w4"], 2450, true))
        await f.handle(disputeWon("dp_w4", ["pi_w4"]))
        const again = await f.handle(disputeWon("dp_w4", ["pi_w4"]))
        expect(again).toMatchObject({ detail: "won dispute already recorded" })
        expect((await restorationOf(tx, f.workspaceId, "dp_w4")).commissions).toHaveLength(1)
      })
    }, 30_000)

    it("a later refund of the same payment counts the won dispute as money given back", async () => {
      await inRollback(async (tx) => {
        const f = await fixture(tx)
        await f.attribute({ providerCustomerId: "cus_w5" })
        await f.handle(payment("pi_w5", [], "cus_w5"))
        await f.handle(refund("dp_w5", ["pi_w5"], 2450, true))
        await f.handle(disputeWon("dp_w5", ["pi_w5"]))

        // Half refunded after the dispute was won: half the commission comes off,
        // and the original stays standing — the payment is not fully refunded.
        await f.handle(refund("re_w5", ["pi_w5"], 2450))
        const { original, reversals } = await f.commissionsOf("pi_w5")
        expect(original.status).toBe("available")
        expect(reversals.map((r) => r.commissionAmountMinor)).toEqual([-735, -735])
      })
    }, 30_000)
  })

  it("does not count the same money twice once an invoice is linked to its PaymentIntent", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      await f.attribute({ providerCustomerId: "cus_x" })
      await f.handle(payment("in_x", [], "cus_x"))
      await f.handle(link("in_x", ["pi_x", "ch_x"]))
      const outcome = await f.handle(payment("pi_x", ["ch_x"], "cus_x"))
      expect(outcome).toMatchObject({ detail: "payment already recorded as in_x" })
    })
  }, 30_000)

  describe("e-mail fallback (T3)", () => {
    it("finds the identified customer by e-mail hash and back-fills its provider id", async () => {
      await inRollback(async (tx) => {
        const f = await fixture(tx)
        // What identify stores without a providerCustomerId.
        const [identified] = await tx
          .insert(schema.customers)
          .values({ workspaceId: f.workspaceId, provider: "stripe", externalId: "user_42", emailHash: hashEmail("ana@example.com") })
          .returning({ id: schema.customers.id })
        await f.attribute({ customerExternalId: "user_42" })

        await f.handle(payment("in_e", [], "cus_e", "  Ana@Example.com "))

        const { original } = await f.commissionsOf("in_e")
        expect(original.commissionAmountMinor).toBe(1470)
        expect(original.customerId).toBe(identified!.id)

        const [customer] = await tx.select().from(schema.customers).where(eq(schema.customers.id, identified!.id))
        expect(customer!.providerCustomerId).toBe("cus_e")
        const [attribution] = await tx
          .select({ providerCustomerId: schema.attributions.providerCustomerId })
          .from(schema.attributions)
          .where(eq(schema.attributions.customerExternalId, "user_42"))
        expect(attribution!.providerCustomerId).toBe("cus_e")

        // The next payment carries no e-mail and still matches, by id.
        await f.handle(payment("in_e2", [], "cus_e", null))
        expect((await f.commissionsOf("in_e2")).original.commissionAmountMinor).toBe(1470)
      })
    }, 30_000)

    it("links through e-mail when a subscription event created the provider customer first", async () => {
      await inRollback(async (tx) => {
        const f = await fixture(tx)
        await tx
          .insert(schema.customers)
          .values({ workspaceId: f.workspaceId, provider: "stripe", externalId: "user_7", emailHash: hashEmail("bia@example.com") })
        await f.attribute({ customerExternalId: "user_7" })
        // e.g. customer.subscription.created, which has no e-mail.
        await tx.insert(schema.customers).values({ workspaceId: f.workspaceId, provider: "stripe", providerCustomerId: "cus_s" })

        await f.handle(payment("in_s", [], "cus_s", "bia@example.com"))
        expect((await f.commissionsOf("in_s")).original.commissionAmountMinor).toBe(1470)
      })
    }, 30_000)

    it("never overwrites a different provider id", async () => {
      await inRollback(async (tx) => {
        const f = await fixture(tx)
        const [other] = await tx
          .insert(schema.customers)
          .values({
            workspaceId: f.workspaceId,
            provider: "stripe",
            externalId: "user_9",
            providerCustomerId: "cus_other",
            emailHash: hashEmail("caio@example.com"),
          })
          .returning({ id: schema.customers.id })
        await f.attribute({ customerExternalId: "user_9" })

        const outcome = await f.handle(payment("in_o", [], "cus_new", "caio@example.com"))
        expect(outcome).toMatchObject({ detail: "payment recorded without attribution" })
        const [row] = await tx.select().from(schema.customers).where(eq(schema.customers.id, other!.id))
        expect(row!.providerCustomerId).toBe("cus_other")
      })
    }, 30_000)
  })
})

describe.runIf(RUN)("one payment, one commission (payment_intent.succeeded + invoice.paid)", () => {
  const commissionRows = async (tx: Tx, workspaceId: string) =>
    tx
      .select({
        amount: schema.commissions.commissionAmountMinor,
        status: schema.commissions.status,
        reversalOf: schema.commissions.reversalOfCommissionId,
      })
      .from(schema.commissions)
      .where(eq(schema.commissions.workspaceId, workspaceId))

  const net = (rows: Array<{ amount: number }>) => rows.reduce((sum, row) => sum + row.amount, 0)

  it("PaymentIntent, then the link, then the invoice: one commission, the invoice records nothing", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      await f.attribute({ providerCustomerId: "cus_o1" })
      await f.handle(payment("pi_o1", ["ch_o1"], "cus_o1"))
      await f.handle(link("in_o1", ["pi_o1", "ch_o1"]))
      expect(await f.handle(payment("in_o1", [], "cus_o1"))).toMatchObject({ detail: "payment already recorded as pi_o1" })

      const rows = await commissionRows(tx, f.workspaceId)
      expect(rows).toHaveLength(1)
      expect(net(rows)).toBe(1470)
    })
  }, 60_000)

  it("the link first, then the PaymentIntent, then the invoice: recorded once, under the invoice", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      await f.attribute({ providerCustomerId: "cus_o2" })
      await f.handle(link("in_o2", ["pi_o2", "ch_o2"]))
      expect(await f.handle(payment("pi_o2", ["ch_o2"], "cus_o2"))).toMatchObject({ detail: "payment belongs to in_o2; recorded with it" })
      await f.handle(payment("in_o2", [], "cus_o2"))

      const rows = await commissionRows(tx, f.workspaceId)
      expect(rows).toHaveLength(1)
      expect((await f.commissionsOf("in_o2")).original.commissionAmountMinor).toBe(1470)
    })
  }, 60_000)

  it("both payment events before the link (either order): the later record is reversed, redeliveries change nothing", async () => {
    for (const order of [["pi", "in"], ["in", "pi"]] as const) {
      await inRollback(async (tx) => {
        const f = await fixture(tx)
        await f.attribute({ providerCustomerId: "cus_o3" })
        const events = { pi: payment("pi_o3", ["ch_o3"], "cus_o3"), in: payment("in_o3", [], "cus_o3") }
        await f.handle(events[order[0]])
        // Separate deliveries commit at different times; inside this one test
        // transaction `now()` is constant, so make the first record older.
        await tx
          .update(schema.transactions)
          .set({ createdAt: new Date("2026-08-01T12:00:01Z") })
          .where(eq(schema.transactions.workspaceId, f.workspaceId))
        await f.handle(events[order[1]])
        expect(await commissionRows(tx, f.workspaceId)).toHaveLength(2)

        await f.handle(link("in_o3", ["pi_o3", "ch_o3"]))
        // Redeliveries of all three, in any order.
        await f.handle(link("in_o3", ["pi_o3", "ch_o3"]))
        await f.handle(events.in)
        await f.handle(events.pi)

        const rows = await commissionRows(tx, f.workspaceId)
        expect(net(rows)).toBe(1470)
        expect(rows.filter((row) => row.reversalOf)).toHaveLength(1)
        // The first record is kept; the second is reversed in full.
        const kept = order[0] === "pi" ? "pi_o3" : "in_o3"
        const duplicate = order[0] === "pi" ? "in_o3" : "pi_o3"
        expect((await f.commissionsOf(kept)).original.status).toBe("available")
        expect((await f.commissionsOf(duplicate)).original.status).toBe("reversed")

        // A refund afterwards reverses the kept commission only.
        await f.handle(refund(`re_o3_${order[0]}`, ["pi_o3", "ch_o3"], 4900))
        expect(net(await commissionRows(tx, f.workspaceId))).toBe(0)
        expect((await f.commissionsOf(kept)).reversals).toHaveLength(1)
      })
    }
  }, 120_000)
})

describe.runIf(RUN)("one payment, one commission — concurrent deliveries (committed, then deleted)", () => {
  it("PaymentIntent, invoice and link delivered at the same time net exactly one commission", async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: `Concurrent ${suffix}`, slug: `concurrent-${suffix}`, defaultCurrency: "BRL" })
      .returning({ id: schema.workspaces.id })
    const workspaceId = ws!.id
    try {
      const [program] = await db
        .insert(schema.programs)
        .values({ workspaceId, name: "P", slug: `p-${suffix}`, status: "active", commissionType: "percentage", commissionValue: 3000, commissionHoldDays: 0, currency: "BRL" })
        .returning({ id: schema.programs.id })
      const [affiliate] = await db
        .insert(schema.affiliates)
        .values({ workspaceId, email: `aff-${suffix}@example.com`, name: "Aff", status: "active" })
        .returning({ id: schema.affiliates.id })
      const [participation] = await db
        .insert(schema.programAffiliates)
        .values({ programId: program!.id, affiliateId: affiliate!.id, code: `c${suffix}`, status: "approved" })
        .returning({ id: schema.programAffiliates.id })
      await db.insert(schema.attributions).values({
        programId: program!.id,
        programAffiliateId: participation!.id,
        visitorId: `v_${crypto.randomUUID()}`,
        attributionModel: "last_click",
        attributedAt: new Date("2026-07-01T00:00:00Z"),
        expiresAt: new Date("2026-12-01T00:00:00Z"),
        providerCustomerId: `cus_${suffix}`,
      })

      for (let round = 0; round < 3; round += 1) {
        const pi = `pi_${suffix}_${round}`
        const invoice = `in_${suffix}_${round}`
        const events = [
          payment(pi, [`ch_${suffix}_${round}`], `cus_${suffix}`),
          payment(invoice, [], `cus_${suffix}`),
          link(invoice, [pi, `ch_${suffix}_${round}`]),
        ]
        await Promise.all(events.map((event) => handleBillingEvent(workspaceId, event, NOW)))
        // And every one of them redelivered, again all at once.
        await Promise.all(events.map((event) => handleBillingEvent(workspaceId, event, NOW)))

        const rows = await db
          .select({ amount: schema.commissions.commissionAmountMinor })
          .from(schema.commissions)
          .innerJoin(schema.transactions, eq(schema.transactions.id, schema.commissions.transactionId))
          .where(
            and(
              eq(schema.commissions.workspaceId, workspaceId),
              inArray(schema.transactions.providerParentTransactionId, [pi, invoice]),
            ),
          )
        const originals = await db
          .select({ amount: schema.commissions.commissionAmountMinor })
          .from(schema.commissions)
          .innerJoin(schema.transactions, eq(schema.transactions.id, schema.commissions.transactionId))
          .where(and(eq(schema.commissions.workspaceId, workspaceId), inArray(schema.transactions.providerTransactionId, [pi, invoice])))
        const netMinor = [...rows, ...originals].reduce((sum, row) => sum + row.amount, 0)
        expect(netMinor).toBe(1470)
      }
    } finally {
      await db.delete(schema.commissions).where(eq(schema.commissions.workspaceId, workspaceId))
      await db.delete(schema.transactionReferences).where(eq(schema.transactionReferences.workspaceId, workspaceId))
      await db.delete(schema.transactions).where(eq(schema.transactions.workspaceId, workspaceId))
      await db.delete(schema.attributions).where(
        inArray(
          schema.attributions.programId,
          db.select({ id: schema.programs.id }).from(schema.programs).where(eq(schema.programs.workspaceId, workspaceId)),
        ),
      )
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId))
    }
  }, 180_000)
})

describe.runIf(RUN)("environments, retries and the renewal lock", () => {
  it("a live event never reaches a test program", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      await f.attribute({ providerCustomerId: "cus_env" })
      const live = { ...payment("in_env", [], "cus_env"), environment: "live" as const }
      expect(await f.handle(live)).toMatchObject({ detail: "payment recorded without attribution" })
      const [row] = await tx
        .select({ environment: schema.transactions.environment })
        .from(schema.transactions)
        .where(and(eq(schema.transactions.workspaceId, f.workspaceId), eq(schema.transactions.providerTransactionId, "in_env")))
      expect(row!.environment).toBe("live")
    })
  }, 60_000)

  it("a refund before its payment fails (so Stripe retries) and succeeds once the payment is recorded", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      await f.attribute({ providerCustomerId: "cus_rb" })
      await expect(f.handle(refund("re_rb", ["pi_rb", "ch_rb"], 4900))).rejects.toBeInstanceOf(PaymentNotRecordedYetError)
      await f.handle(payment("pi_rb", ["ch_rb"], "cus_rb"))
      expect(await f.handle(refund("re_rb", ["pi_rb", "ch_rb"], 4900))).toMatchObject({ status: "processed" })
      expect((await f.commissionsOf("pi_rb")).original.status).toBe("reversed")
    })
  }, 60_000)

  it("a refund of a payment left out of the ledger (no customer) is ignored, not retried forever", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      // A Payment Link / one-off Checkout payment that created no Stripe
      // customer. Typed explicitly: spreading over the event union widens it.
      const guest: Extract<Event, { type: "payment.succeeded" }> = {
        ...payment("pi_guest", ["ch_guest"], "cus_x"),
        providerCustomerId: null,
      }
      expect(await f.handle(guest)).toMatchObject({ status: "ignored" })
      expect(await f.handle(refund("re_guest", ["ch_guest"], 100))).toMatchObject({ status: "ignored" })
    })
  }, 60_000)

  it("renewals keep paying the affiliate that converted the customer, even with a newer bound attribution", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      await f.attribute({ providerCustomerId: "cus_lock" })
      await f.handle(payment("in_lock1", [], "cus_lock"))
      const first = (await f.commissionsOf("in_lock1")).original

      // A second affiliate, and a newer attribution bound to the same customer.
      const [program] = await tx.select({ id: schema.programs.id }).from(schema.programs).where(eq(schema.programs.workspaceId, f.workspaceId))
      const [other] = await tx
        .insert(schema.affiliates)
        .values({ workspaceId: f.workspaceId, email: `other-${crypto.randomUUID()}@example.com`, name: "Other", status: "active" })
        .returning({ id: schema.affiliates.id })
      const [otherParticipation] = await tx
        .insert(schema.programAffiliates)
        .values({ programId: program!.id, affiliateId: other!.id, code: `o${crypto.randomUUID().slice(0, 8)}`, status: "approved" })
        .returning({ id: schema.programAffiliates.id })
      await tx.insert(schema.attributions).values({
        programId: program!.id,
        programAffiliateId: otherParticipation!.id,
        visitorId: `v_${crypto.randomUUID()}`,
        attributionModel: "last_click",
        attributedAt: new Date("2026-07-20T00:00:00Z"),
        expiresAt: new Date("2026-12-01T00:00:00Z"),
        providerCustomerId: "cus_lock",
      })

      await f.handle(payment("in_lock2", [], "cus_lock"))
      expect((await f.commissionsOf("in_lock2")).original.programAffiliateId).toBe(first.programAffiliateId)
    })
  }, 60_000)
})

describe.runIf(RUN)("ingestVerifiedWebhook", () => {
  const refundProvider = (eventId: string) =>
    ({
      id: "stripe" as const,
      normalizeEvent: () => ({ ...refund(`re_${eventId}`, [`pi_${eventId}`], 100), providerEventId: eventId }),
    }) as unknown as Parameters<typeof ingestVerifiedWebhook>[0]["provider"]

  it("acknowledges a live event for a workspace without live mode and does not claim it", async () => {
    const eventId = `evt_live_${crypto.randomUUID()}`
    // No subscription row: a Sandbox workspace.
    const workspaceId = crypto.randomUUID()
    const result = await ingestVerifiedWebhook({
      provider: refundProvider(eventId),
      verified: { providerEventId: eventId, rawType: "refund.created", providerAccountId: null, environment: "live", payload: {} },
      rawBody: "{}",
      workspaceId,
    })
    expect(result).toEqual({ status: "ignored", reason: "live_mode_inactive" })
    const rows = await db.select().from(schema.webhookEvents).where(eq(schema.webhookEvents.providerEventId, eventId))
    expect(rows).toHaveLength(0)
  }, 60_000)

  it("a failed event is claimed again on the provider's retry instead of being answered as a duplicate", async () => {
    const eventId = `evt_retry_${crypto.randomUUID()}`
    const suffix = crypto.randomUUID().slice(0, 8)
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: `Retry ${suffix}`, slug: `retry-${suffix}`, defaultCurrency: "BRL" })
      .returning({ id: schema.workspaces.id })
    const call = () =>
      ingestVerifiedWebhook({
        provider: refundProvider(eventId),
        verified: { providerEventId: eventId, rawType: "refund.created", providerAccountId: null, environment: "test", payload: {} },
        rawBody: "{}",
        workspaceId: ws!.id,
      })
    try {
      expect(await call()).toEqual({ status: "failed" })
      expect(await call()).toEqual({ status: "failed" })
      const [row] = await db.select().from(schema.webhookEvents).where(eq(schema.webhookEvents.providerEventId, eventId))
      expect(row!.status).toBe("failed")
      expect(row!.errorMessage).toContain("not recorded yet")
      expect(row!.environment).toBe("test")
    } finally {
      await db.delete(schema.webhookEvents).where(eq(schema.webhookEvents.providerEventId, eventId))
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, ws!.id))
    }
  }, 60_000)
})

describe.runIf(RUN)("integration health through latest_webhook_event", () => {
  it("answers a member under RLS and refuses a non-member (read-only)", async () => {
    const { getIntegrationHealth } = await import("../integration-health")
    const [member] = await db
      .select({ workspaceId: schema.workspaceMembers.workspaceId, userId: schema.workspaceMembers.userId })
      .from(schema.workspaceMembers)
      .limit(1)
    if (!member) return

    const health = await getIntegrationHealth(member.userId, member.workspaceId)
    expect(typeof health.stripe.lastEventFailed).toBe("boolean")
    expect(health.stripe.lastEventAt === null || health.stripe.lastEventAt instanceof Date).toBe(true)

    await expect(
      getIntegrationHealth("00000000-0000-4000-8000-000000000001", member.workspaceId),
    ).rejects.toMatchObject({ name: "AppError" })
  }, 30_000)
})

describe.skipIf(RUN)("billing events against Postgres (skipped)", () => {
  it.skip("set RUN_DB_TESTS=1 to run against the database in .env.local", () => {})
})
