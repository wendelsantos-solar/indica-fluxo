/**
 * Refund/dispute matching (T6) and the e-mail fallback (T3) against a real
 * Postgres. Every test runs inside a transaction that is rolled back, so
 * nothing persists. Opt-in, because CI has no database:
 *
 *   RUN_DB_TESTS=1 pnpm exec vitest run src/server/services/__tests__/billing-events.db.test.ts
 */
import { config } from "dotenv"
import { and, eq } from "drizzle-orm"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
config({ path: ".env.local", quiet: true })

const RUN = process.env.RUN_DB_TESTS === "1"

const { db } = await import("@/server/db")
const schema = await import("@/server/db/schema")
const { handleBillingEvent } = await import("../billing-events")
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

const base = { provider: "stripe" as const, providerAccountId: null, occurredAt: PAID_AT }

function payment(id: string, references: string[], customer: string, email: string | null = null, amountMinor = 4900): Event {
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
