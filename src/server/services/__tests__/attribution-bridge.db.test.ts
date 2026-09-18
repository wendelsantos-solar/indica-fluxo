/**
 * The attribution bridge against a real Postgres: a referral becoming a
 * commission without the founder ever calling `/api/identify`
 * (INTEGRATION_ARCHITECTURE_V2.md). Every test runs inside a transaction that
 * is rolled back, so nothing persists. Opt-in, because CI has no database:
 *
 *   RUN_DB_TESTS=1 pnpm exec vitest run src/server/services/__tests__/attribution-bridge.db.test.ts
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
const { issueAttributionToken, bindAttributionToken } = await import("../attribution-bridge")

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Event = Parameters<typeof handleBillingEvent>[1]

const PAID_AT = new Date("2026-08-01T12:00:00Z")
const NOW = new Date("2026-08-02T12:00:00Z")
const ROLLBACK = new Error("rollback")

async function inRollback(run: (tx: Tx) => Promise<void>) {
  await db
    .transaction(async (tx) => {
      await run(tx)
      throw ROLLBACK
    })
    .catch((error) => {
      if (error !== ROLLBACK) throw error
    })
}

/** A workspace with an active 30% BRL program, no hold, one approved affiliate. */
async function fixture(tx: Tx, environment: "test" | "live" = "test") {
  const suffix = crypto.randomUUID().slice(0, 8)
  const [ws] = await tx
    .insert(schema.workspaces)
    .values({ name: `AB ${suffix}`, slug: `ab-${suffix}`, defaultCurrency: "BRL" })
    .returning({ id: schema.workspaces.id })
  const workspaceId = ws!.id

  const [program] = await tx
    .insert(schema.programs)
    .values({
      workspaceId,
      name: "P",
      slug: `p-${suffix}`,
      status: "active",
      environment,
      commissionType: "percentage",
      commissionValue: 3000,
      commissionHoldDays: 0,
      currency: "BRL",
      attributionWindowDays: 60,
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

  const visitorId = `v_${crypto.randomUUID().replace(/-/g, "")}`

  /** The click, as `recordClick` would have left it, plus the issued reference. */
  const referral = async () => {
    await tx.insert(schema.attributions).values({
      programId: program!.id,
      programAffiliateId: participation!.id,
      visitorId,
      attributionModel: "last_click",
      attributedAt: new Date("2026-07-01T00:00:00Z"),
      expiresAt: new Date("2026-12-01T00:00:00Z"),
    })
    const { token } = await issueAttributionToken(tx, {
      workspaceId,
      environment,
      visitorId,
      windowDays: 60,
    })
    return token!
  }

  const handle = (event: Event) => handleBillingEvent(workspaceId, event, NOW, tx)

  const commissionCount = async () => {
    const rows = await tx
      .select({ id: schema.commissions.id })
      .from(schema.commissions)
      .where(eq(schema.commissions.workspaceId, workspaceId))
    return rows.length
  }

  const attributionOf = async () => {
    const [row] = await tx
      .select()
      .from(schema.attributions)
      .where(and(eq(schema.attributions.programId, program!.id), eq(schema.attributions.visitorId, visitorId)))
    return row!
  }

  return { workspaceId, visitorId, environment, referral, handle, commissionCount, attributionOf }
}

const base = {
  provider: "stripe" as const,
  providerAccountId: null,
  occurredAt: PAID_AT,
  environment: "test" as const,
}

function checkout(token: string, customer: string, id = "cs_1"): Event {
  return {
    ...base,
    type: "attribution.bind",
    providerEventId: `evt_${id}`,
    rawType: "checkout.session.completed",
    attributionToken: token,
    providerCustomerId: customer,
    providerSubscriptionId: null,
  }
}

function payment(
  id: string,
  customer: string,
  extra: { attributionToken?: string | null; amountMinor?: number } = {},
): Extract<Event, { type: "payment.succeeded" }> {
  return {
    ...base,
    type: "payment.succeeded",
    providerEventId: `evt_${id}`,
    rawType: id.startsWith("in_") ? "invoice.paid" : "payment_intent.succeeded",
    providerTransactionId: id,
    providerReferences: [],
    providerCustomerId: customer,
    providerSubscriptionId: null,
    customerEmail: null,
    currency: "BRL",
    amountMinor: extra.amountMinor ?? 4900,
    attributionToken: extra.attributionToken ?? null,
  }
}

describe.skipIf(!RUN)("attribution bridge", () => {
  it("Stripe Checkout: reference then payment earns the commission, with no identify call", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const token = await f.referral()

      expect(await f.handle(checkout(token, "cus_a"))).toMatchObject({ status: "processed" })
      expect((await f.attributionOf()).providerCustomerId).toBe("cus_a")
      // The bind never creates money of its own.
      expect(await f.commissionCount()).toBe(0)

      await f.handle(payment("in_a", "cus_a"))
      expect(await f.commissionCount()).toBe(1)
    })
  }, 60_000)

  it("payment before the reference: the late bind backfills the commission", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const token = await f.referral()

      // Stripe orders nothing: the invoice can beat the session.
      await f.handle(payment("in_b", "cus_b"))
      expect(await f.commissionCount()).toBe(0)

      expect(await f.handle(checkout(token, "cus_b"))).toMatchObject({ status: "processed" })
      expect(await f.commissionCount()).toBe(1)
    })
  }, 60_000)

  it("a redelivered checkout session does not create a second commission", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const token = await f.referral()

      await f.handle(payment("in_c", "cus_c"))
      await f.handle(checkout(token, "cus_c"))
      await f.handle(checkout(token, "cus_c"))
      await f.handle(checkout(token, "cus_c"))

      expect(await f.commissionCount()).toBe(1)
    })
  }, 60_000)

  it("PaymentIntent metadata binds and earns in one event (Elements / custom checkout)", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const token = await f.referral()

      await f.handle(payment("pi_d", "cus_d", { attributionToken: token }))

      expect((await f.attributionOf()).providerCustomerId).toBe("cus_d")
      expect(await f.commissionCount()).toBe(1)
    })
  }, 60_000)

  it("a renewal needs no reference: the customer binding carries it", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const token = await f.referral()

      await f.handle(checkout(token, "cus_e"))
      await f.handle(payment("in_e1", "cus_e"))
      await f.handle(payment("in_e2", "cus_e"))

      expect(await f.commissionCount()).toBe(2)
    })
  }, 60_000)

  it("a reference already bound to another customer is refused, not moved", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const token = await f.referral()

      await f.handle(checkout(token, "cus_first"))
      expect(await f.handle(checkout(token, "cus_second", "cs_2"))).toMatchObject({
        status: "ignored",
        reason: "attribution reference token_conflict",
      })

      expect((await f.attributionOf()).providerCustomerId).toBe("cus_first")
    })
  }, 60_000)

  it("an unknown reference is ignored and the payment is still recorded", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      await f.referral()

      const forged = `ifx_${"a".repeat(43)}`
      expect(await f.handle(checkout(forged, "cus_f"))).toMatchObject({
        status: "ignored",
        reason: "attribution reference token_unknown",
      })

      await f.handle(payment("in_f", "cus_f"))
      const rows = await tx
        .select({ id: schema.transactions.id })
        .from(schema.transactions)
        .where(eq(schema.transactions.providerTransactionId, "in_f"))
      expect(rows).toHaveLength(1)
      expect(await f.commissionCount()).toBe(0)
    })
  }, 60_000)

  it("a tampered reference resolves to nothing", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const token = await f.referral()
      const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`

      expect(await f.handle(checkout(tampered, "cus_g"))).toMatchObject({ status: "ignored" })
      expect((await f.attributionOf()).providerCustomerId).toBeNull()
    })
  }, 60_000)

  it("an expired reference does not bind", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const token = await f.referral()
      await tx
        .update(schema.attributionTokens)
        .set({ expiresAt: new Date("2020-01-01T00:00:00Z") })
        .where(eq(schema.attributionTokens.workspaceId, f.workspaceId))

      expect(await f.handle(checkout(token, "cus_h"))).toMatchObject({
        status: "ignored",
        reason: "attribution reference token_expired",
      })
    })
  }, 60_000)

  it("a live event never resolves a test reference", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const token = await f.referral()

      const live = { ...checkout(token, "cus_i"), environment: "live" as const }
      expect(await f.handle(live)).toMatchObject({
        status: "ignored",
        reason: "attribution reference token_unknown",
      })
      expect((await f.attributionOf()).providerCustomerId).toBeNull()
    })
  }, 60_000)

  it("a reference from another workspace resolves to nothing", async () => {
    await inRollback(async (tx) => {
      const mine = await fixture(tx)
      const theirs = await fixture(tx)
      const foreign = await theirs.referral()

      expect(await mine.handle(checkout(foreign, "cus_j"))).toMatchObject({
        status: "ignored",
        reason: "attribution reference token_unknown",
      })
      expect((await theirs.attributionOf()).providerCustomerId).toBeNull()
    })
  }, 60_000)

  it("the tracker's own reference is reused and extended, not re-minted per click", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const first = await f.referral()

      const again = await issueAttributionToken(tx, {
        workspaceId: f.workspaceId,
        environment: "test",
        visitorId: f.visitorId,
        presented: first,
        windowDays: 90,
      })
      expect(again).toMatchObject({ token: first, reused: true })

      const rows = await tx
        .select({ id: schema.attributionTokens.id })
        .from(schema.attributionTokens)
        .where(eq(schema.attributionTokens.workspaceId, f.workspaceId))
      expect(rows).toHaveLength(1)
    })
  }, 60_000)

  it("identify still works, and a bind after it changes nothing about who is paid", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const token = await f.referral()

      const { identifyCustomer } = await import("../identify")
      await identifyCustomer(
        {
          workspaceId: f.workspaceId,
          environment: "test",
          visitorId: f.visitorId,
          externalId: "user_1",
          providerCustomerId: "cus_k",
        },
        // The service opens its own transaction; hand it this one so the
        // whole test still rolls back.
        { transaction: ((run: (inner: Tx) => unknown) => run(tx)) as never },
      )

      await f.handle(checkout(token, "cus_k"))
      await f.handle(payment("in_k", "cus_k"))

      const attribution = await f.attributionOf()
      expect(attribution.providerCustomerId).toBe("cus_k")
      expect(attribution.customerExternalId).toBe("user_1")
      expect(await f.commissionCount()).toBe(1)
    })
  }, 60_000)

  it("binding twice concurrently produces one commission", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const token = await f.referral()
      await f.handle(payment("in_l", "cus_l"))

      // Same transaction, so not truly parallel — what is asserted is that the
      // second bind is a no-op rather than a second backfill.
      await f.handle(checkout(token, "cus_l"))
      await f.handle(checkout(token, "cus_l", "cs_l2"))

      expect(await f.commissionCount()).toBe(1)
    })
  }, 60_000)

  it("a payment with no reference and no identify is recorded without a commission", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      await f.referral()

      await f.handle(payment("in_m", "cus_m"))

      expect(await f.commissionCount()).toBe(0)
      const rows = await tx
        .select({ id: schema.transactions.id })
        .from(schema.transactions)
        .where(eq(schema.transactions.providerTransactionId, "in_m"))
      expect(rows).toHaveLength(1)
    })
  }, 60_000)

  it("bindAttributionToken creates the customer row when the webhook has not seen it yet", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const token = await f.referral()

      const outcome = await bindAttributionToken(tx, {
        workspaceId: f.workspaceId,
        environment: "test",
        provider: "stripe",
        token,
        providerCustomerId: "cus_n",
      })
      expect(outcome).toMatchObject({ status: "bound", attributionsBound: 1 })

      const [customer] = await tx
        .select({ id: schema.customers.id, providerCustomerId: schema.customers.providerCustomerId })
        .from(schema.customers)
        .where(eq(schema.customers.workspaceId, f.workspaceId))
      expect(customer!.providerCustomerId).toBe("cus_n")
    })
  }, 60_000)
})
