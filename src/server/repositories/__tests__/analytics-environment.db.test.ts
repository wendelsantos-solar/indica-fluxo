/**
 * The dashboard's read models against Postgres: one environment at a time
 * (docs/PLANS.md §2) and the analytics definitions in `analytics.ts` —
 * duplicates left out, refunds netted, commissions on the payment clock,
 * "ready to pay" without batched commissions, trials only for referred
 * customers. Every test runs inside a transaction that is rolled back. Opt-in:
 *
 *   RUN_DB_TESTS=1 pnpm exec vitest run src/server/repositories/__tests__/analytics-environment.db.test.ts
 */
import { config } from "dotenv"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
config({ path: ".env.local", quiet: true })

const RUN = process.env.RUN_DB_TESTS === "1"

const { db } = await import("@/server/db")
const schema = await import("@/server/db/schema")
const analytics = await import("../analytics")
const { listCommissions } = await import("../commissions")
const { listAffiliates } = await import("../affiliates")

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const ROLLBACK = new Error("rollback")
const DAY = 86_400_000
const NOW = new Date()
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY)
const PERIOD = { days: 30, timeZone: "America/Sao_Paulo", now: NOW }

async function rolledBack(fn: (tx: Tx) => Promise<void>) {
  await expect(
    db.transaction(async (tx) => {
      await fn(tx)
      throw ROLLBACK
    }),
  ).rejects.toBe(ROLLBACK)
}

/**
 * Live: a payment (60 commission, available) partly refunded (−50 / −15), the
 * same payment recorded twice and reversed as a duplicate, a second customer's
 * payment whose commission sits in an approved batch, a referred and a
 * non-referred subscription, one click.
 * Test: one payment with a commission still on hold, two clicks.
 */
async function seed(tx: Tx) {
  const suffix = crypto.randomUUID().slice(0, 8)
  const [ws] = await tx
    .insert(schema.workspaces)
    .values({ name: `env ${suffix}`, slug: `env-${suffix}`, defaultCurrency: "BRL" })
    .returning({ id: schema.workspaces.id })
  const workspaceId = ws!.id

  const program = async (environment: "test" | "live") => {
    const [row] = await tx
      .insert(schema.programs)
      .values({
        workspaceId,
        name: `${environment} ${suffix}`,
        slug: `${environment}-${suffix}`,
        status: "active",
        environment,
        commissionType: "percentage",
        commissionValue: 3000,
        commissionHoldDays: 0,
        currency: "BRL",
      })
      .returning({ id: schema.programs.id })
    return row!.id
  }
  const liveProgram = await program("live")
  const testProgram = await program("test")

  const [affiliate] = await tx
    .insert(schema.affiliates)
    .values({ workspaceId, email: `aff-${suffix}@example.com`, name: "Aff", status: "active" })
    .returning({ id: schema.affiliates.id })
  const participation = async (programId: string, code: string) => {
    const [row] = await tx
      .insert(schema.programAffiliates)
      .values({ programId, affiliateId: affiliate!.id, code, status: "approved" })
      .returning({ id: schema.programAffiliates.id })
    return row!.id
  }
  const livePa = await participation(liveProgram, `l${suffix}`)
  const testPa = await participation(testProgram, `t${suffix}`)

  const click = (programId: string, programAffiliateId: string, occurredAt: Date) =>
    tx.insert(schema.referralClicks).values({
      programId,
      programAffiliateId,
      visitorId: `v_${crypto.randomUUID()}`,
      landingUrl: "https://example.com/",
      occurredAt,
    })
  await click(liveProgram, livePa, daysAgo(5))
  await click(testProgram, testPa, daysAgo(2))
  await click(testProgram, testPa, daysAgo(2))

  const customer = async (environment: "test" | "live", programId: string | null) => {
    const [row] = await tx
      .insert(schema.customers)
      .values({ workspaceId, environment, provider: "stripe", externalId: `cu_${crypto.randomUUID()}`, programId })
      .returning({ id: schema.customers.id })
    return row!.id
  }
  const liveCustomer = await customer("live", liveProgram)
  const liveCustomer2 = await customer("live", liveProgram)
  const strangerCustomer = await customer("live", null)
  const testCustomer = await customer("test", testProgram)

  const transaction = async (values: {
    customerId: string
    environment: "test" | "live"
    id: string
    type: "payment" | "refund" | "adjustment"
    minor: number
    at: Date
    parent?: string
  }) => {
    const [row] = await tx
      .insert(schema.transactions)
      .values({
        workspaceId,
        customerId: values.customerId,
        provider: "stripe",
        providerTransactionId: values.id,
        providerParentTransactionId: values.parent ?? null,
        type: values.type,
        environment: values.environment,
        currency: "BRL",
        grossAmountMinor: values.minor,
        occurredAt: values.at,
      })
      .returning({ id: schema.transactions.id })
    return row!.id
  }
  const commission = async (values: {
    programId: string
    programAffiliateId: string
    customerId: string
    transactionId: string
    base: number
    amount: number
    status: "pending" | "available" | "approved" | "reversed"
    eligibleAt: Date
    reversalOf?: string
  }) => {
    const [row] = await tx
      .insert(schema.commissions)
      .values({
        workspaceId,
        programId: values.programId,
        programAffiliateId: values.programAffiliateId,
        customerId: values.customerId,
        transactionId: values.transactionId,
        currency: "BRL",
        baseAmountMinor: values.base,
        commissionAmountMinor: values.amount,
        status: values.status,
        eligibleAt: values.eligibleAt,
        reversalOfCommissionId: values.reversalOf ?? null,
      })
      .returning({ id: schema.commissions.id })
    return row!.id
  }
  const live = { programId: liveProgram, programAffiliateId: livePa }

  // 200,00 paid, 60,00 earned and available.
  const paid = await transaction({ customerId: liveCustomer, environment: "live", id: `in_${suffix}`, type: "payment", minor: 20000, at: daysAgo(5) })
  const earned = await commission({ ...live, customerId: liveCustomer, transactionId: paid, base: 20000, amount: 6000, status: "available", eligibleAt: daysAgo(5) })
  // 50,00 refunded: −15,00 reversal, available (partial refund of an available commission).
  const refund = await transaction({ customerId: liveCustomer, environment: "live", id: `re_${suffix}`, type: "refund", minor: -5000, at: daysAgo(3), parent: `in_${suffix}` })
  await commission({ ...live, customerId: liveCustomer, transactionId: refund, base: -5000, amount: -1500, status: "available", eligibleAt: daysAgo(3), reversalOf: earned })
  // The same payment recorded again under its PaymentIntent, then reversed as a duplicate.
  const duplicate = await transaction({ customerId: liveCustomer, environment: "live", id: `pi_${suffix}`, type: "payment", minor: 20000, at: daysAgo(5) })
  const duplicateCommission = await commission({ ...live, customerId: liveCustomer, transactionId: duplicate, base: 20000, amount: 6000, status: "reversed", eligibleAt: daysAgo(5) })
  const adjustment = await transaction({ customerId: liveCustomer, environment: "live", id: `dup_pi_${suffix}`, type: "adjustment", minor: -20000, at: daysAgo(4), parent: `pi_${suffix}` })
  await commission({ ...live, customerId: liveCustomer, transactionId: adjustment, base: -20000, amount: -6000, status: "reversed", eligibleAt: daysAgo(4), reversalOf: duplicateCommission })
  // A second customer: 100,00 paid, 30,00 already in an approved batch.
  const paid2 = await transaction({ customerId: liveCustomer2, environment: "live", id: `in2_${suffix}`, type: "payment", minor: 10000, at: daysAgo(2) })
  const batched = await commission({ ...live, customerId: liveCustomer2, transactionId: paid2, base: 10000, amount: 3000, status: "approved", eligibleAt: daysAgo(2) })
  const [batch] = await tx
    .insert(schema.payoutBatches)
    .values({ workspaceId, reference: `b-${suffix}`, environment: "live", currency: "BRL", periodStart: daysAgo(30), periodEnd: NOW, status: "approved", totalAmountMinor: 3000 })
    .returning({ id: schema.payoutBatches.id })
  const [item] = await tx
    .insert(schema.payoutItems)
    .values({ payoutBatchId: batch!.id, programAffiliateId: livePa, amountMinor: 3000, currency: "BRL" })
    .returning({ id: schema.payoutItems.id })
  await tx.insert(schema.payoutItemCommissions).values({ payoutItemId: item!.id, commissionId: batched })

  const subscription = (customerId: string, id: string) =>
    tx.insert(schema.subscriptions).values({
      workspaceId,
      customerId,
      provider: "stripe",
      providerSubscriptionId: id,
      status: "trialing",
      currency: "BRL",
      amountMinor: 9900,
      startedAt: daysAgo(6),
    })
  await subscription(liveCustomer, `sub_${suffix}`)
  // A subscriber nobody referred: not the program's trial.
  await subscription(strangerCustomer, `sub_other_${suffix}`)

  // Test: 80,00 paid, 24,00 still on hold.
  const testPaid = await transaction({ customerId: testCustomer, environment: "test", id: `in_test_${suffix}`, type: "payment", minor: 8000, at: daysAgo(1) })
  await commission({
    programId: testProgram,
    programAffiliateId: testPa,
    customerId: testCustomer,
    transactionId: testPaid,
    base: 8000,
    amount: 2400,
    status: "pending",
    eligibleAt: new Date(NOW.getTime() + 30 * DAY),
  })

  return { workspaceId, affiliateId: affiliate!.id }
}

const brl = (amountMinor: number) => [{ currency: "BRL", amountMinor }]
/** A currency with nothing in it may be listed as zero; only amounts matter. */
const nonZero = (totals: { currency: string; amountMinor: number }[]) => totals.filter((total) => total.amountMinor !== 0)

describe.runIf(RUN)("dashboard read models by environment", () => {
  it("overview figures in live exclude test rows, and follow the definitions", async () => {
    await rolledBack(async (tx) => {
      const { workspaceId } = await seed(tx)
      const overview = await analytics.getDashboardOverview(tx, workspaceId, "live", PERIOD)

      // 200 + 100 paid, −50 refunded; the duplicate record counts once.
      expect(overview.revenue).toEqual(brl(25000))
      // 60 − 15 + 30; the duplicate commission and its reversal left out.
      expect(overview.commission).toEqual(brl(7500))
      expect(overview.netRevenue).toEqual(brl(17500))
      // Batched commissions are not ready to pay.
      expect(overview.availableCommission).toEqual(brl(4500))
      expect(nonZero(overview.pendingCommission)).toEqual([])
      expect(overview.customersAcquired).toBe(2)
      expect(overview.clicks).toBe(1)
      expect(overview.approvedAffiliates).toBe(1)
      expect(overview.hasCommission).toBe(true)

      const funnel = Object.fromEntries(
        (await analytics.getConversionFunnel(tx, workspaceId, "live", PERIOD)).map((step) => [step.key, step.value]),
      )
      expect(funnel).toEqual({ clicks: 1, signups: 0, trials: 1, customers: 2 })

      const series = await analytics.getRevenueSeries(tx, workspaceId, "live", "BRL", PERIOD)
      expect(series.points.reduce((sum, point) => sum + point.revenueMinor, 0)).toBe(25000)
      expect(series.points.reduce((sum, point) => sum + point.commissionMinor, 0)).toBe(7500)
      expect(series.otherCurrencies).toEqual([])
    })
  }, 60_000)

  it("overview figures in test exclude live rows", async () => {
    await rolledBack(async (tx) => {
      const { workspaceId } = await seed(tx)
      const overview = await analytics.getDashboardOverview(tx, workspaceId, "test", PERIOD)

      expect(overview.revenue).toEqual(brl(8000))
      expect(overview.commission).toEqual(brl(2400))
      expect(overview.pendingCommission).toEqual(brl(2400))
      expect(nonZero(overview.availableCommission)).toEqual([])
      expect(overview.customersAcquired).toBe(1)
      expect(overview.clicks).toBe(2)

      const funnel = Object.fromEntries(
        (await analytics.getConversionFunnel(tx, workspaceId, "test", PERIOD)).map((step) => [step.key, step.value]),
      )
      expect(funnel).toEqual({ clicks: 2, signups: 0, trials: 0, customers: 1 })

      const top = await analytics.getTopAffiliates(tx, workspaceId, "test")
      expect(top.map((row) => row.commissionMinor)).toEqual([2400])
      const recent = await analytics.getRecentConversions(tx, workspaceId, "test")
      expect(recent).toHaveLength(1)
    })
  }, 60_000)

  it("commission, conversion and affiliate lists keep to one environment", async () => {
    await rolledBack(async (tx) => {
      const { workspaceId, affiliateId } = await seed(tx)

      const liveCommissions = await listCommissions(tx, { workspaceId, environment: "live" })
      expect(liveCommissions.total).toBe(5)
      expect(liveCommissions.totals).toEqual(brl(7500))
      const testCommissions = await listCommissions(tx, { workspaceId, environment: "test" })
      expect(testCommissions.total).toBe(1)
      expect(testCommissions.totals).toEqual(brl(2400))

      expect((await analytics.listConversions(tx, { workspaceId, environment: "live" })).total).toBe(5)
      expect((await analytics.listConversions(tx, { workspaceId, environment: "test", affiliateId })).total).toBe(1)

      const liveAffiliates = await listAffiliates(tx, { workspaceId, environment: "live" })
      expect(liveAffiliates.total).toBe(1)
      expect(liveAffiliates.rows[0]!.commissionMinor).toBe(7500)
      const testAffiliates = await listAffiliates(tx, { workspaceId, environment: "test" })
      expect(testAffiliates.rows.map((row) => row.commissionMinor)).toEqual([2400])

      expect(await analytics.workspaceHasLivePrograms(tx, workspaceId)).toBe(true)
    })
  }, 60_000)
})
