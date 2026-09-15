/**
 * The Sandbox simulation against a real Postgres: a synthetic click, identify
 * and payment through the real services, then a renewal and a refund. Every
 * test runs inside a transaction that is rolled back. Opt-in:
 *
 *   RUN_DB_TESTS=1 pnpm exec vitest run src/server/services/__tests__/sandbox.db.test.ts
 */
import { config } from "dotenv"
import { eq } from "drizzle-orm"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
config({ path: ".env.local", quiet: true })

const RUN = process.env.RUN_DB_TESTS === "1"

const { db } = await import("@/server/db")
const schema = await import("@/server/db/schema")
const { runTestConversion, runTestRefund, runTestRenewal } = await import("../sandbox")

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const ROLLBACK = new Error("rollback")

async function inRollback(fn: (tx: Tx) => Promise<void>) {
  await expect(
    db.transaction(async (tx) => {
      await fn(tx)
      throw ROLLBACK
    }),
  ).rejects.toBe(ROLLBACK)
}

async function fixture(tx: Tx, environment: "test" | "live" = "test") {
  const suffix = crypto.randomUUID().slice(0, 8)
  const [ws] = await tx
    .insert(schema.workspaces)
    .values({ name: `Sandbox ${suffix}`, slug: `sandbox-${suffix}`, defaultCurrency: "BRL" })
    .returning({ id: schema.workspaces.id })
  const [program] = await tx
    .insert(schema.programs)
    .values({
      workspaceId: ws!.id,
      name: "P",
      slug: `p-${suffix}`,
      status: "active",
      environment,
      commissionType: "percentage",
      commissionValue: 3000,
      commissionHoldDays: 0,
      commissionDurationMonths: null,
      currency: "BRL",
    })
    .returning({ id: schema.programs.id })
  const [affiliate] = await tx
    .insert(schema.affiliates)
    .values({ workspaceId: ws!.id, email: `aff-${suffix}@example.com`, name: "Aff", status: "active" })
    .returning({ id: schema.affiliates.id })
  const [participation] = await tx
    .insert(schema.programAffiliates)
    .values({ programId: program!.id, affiliateId: affiliate!.id, code: `c${suffix}`, status: "approved" })
    .returning({ id: schema.programAffiliates.id })
  return { workspaceId: ws!.id, programId: program!.id, participationId: participation!.id }
}

describe.runIf(RUN)("sandbox simulation", () => {
  it("creates a click, attribution, customer, transaction and commission in test; renews; refunds", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const simulationId = crypto.randomUUID()
      const input = { programId: f.programId, participationId: f.participationId, amountMinor: 4900, simulationId }

      const conversion = await runTestConversion(tx, f.workspaceId, input)
      expect(conversion.commission).toMatchObject({ amountMinor: 1470, currency: "BRL", status: "available" })

      const [click] = await tx.select().from(schema.referralClicks).where(eq(schema.referralClicks.programId, f.programId))
      expect(click).toBeDefined()
      const [attribution] = await tx.select().from(schema.attributions).where(eq(schema.attributions.programId, f.programId))
      expect(attribution!.customerExternalId).toBe(conversion.customerExternalId)
      const customers = await tx.select().from(schema.customers).where(eq(schema.customers.workspaceId, f.workspaceId))
      expect(customers).toHaveLength(1)
      expect(customers[0]!.environment).toBe("test")
      const payments = await tx.select().from(schema.transactions).where(eq(schema.transactions.workspaceId, f.workspaceId))
      expect(payments.map((row) => [row.environment, row.type])).toEqual([["test", "payment"]])

      // Replaying the same simulation (a double submit) records nothing new.
      expect(await runTestConversion(tx, f.workspaceId, input)).toMatchObject({ commission: { id: conversion.commission!.id } })
      expect(await tx.select().from(schema.referralClicks).where(eq(schema.referralClicks.programId, f.programId))).toHaveLength(1)

      const renewal = await runTestRenewal(tx, f.workspaceId, {
        customerExternalId: conversion.customerExternalId,
        amountMinor: 4900,
        simulationId: crypto.randomUUID(),
      })
      expect(renewal.commission).toMatchObject({ amountMinor: 1470 })
      expect(renewal.commission!.id).not.toBe(conversion.commission!.id)

      const refund = await runTestRefund(tx, f.workspaceId, {
        customerExternalId: conversion.customerExternalId,
        simulationId: crypto.randomUUID(),
      })
      expect(refund.commission).toMatchObject({ amountMinor: -1470, status: "reversed" })

      const ledger = await tx.select().from(schema.commissions).where(eq(schema.commissions.workspaceId, f.workspaceId))
      expect(ledger.reduce((sum, row) => sum + row.commissionAmountMinor, 0)).toBe(1470)
    })
  }, 120_000)

  it("refuses a live program", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx, "live")
      await expect(
        runTestConversion(tx, f.workspaceId, {
          programId: f.programId,
          participationId: f.participationId,
          amountMinor: 4900,
          simulationId: crypto.randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "validation_error", messageKey: "sandboxLiveProgram" })
      expect(await tx.select().from(schema.referralClicks).where(eq(schema.referralClicks.programId, f.programId))).toHaveLength(0)
    })
  }, 60_000)
})

describe.skipIf(RUN)("sandbox against Postgres (skipped)", () => {
  it.skip("set RUN_DB_TESTS=1 to run against the database in .env.local", () => {})
})
