/**
 * Tracking, identify and publishable keys against a real Postgres, per
 * environment. Every test runs inside a transaction that is rolled back.
 * Opt-in, because CI has no database:
 *
 *   RUN_DB_TESTS=1 pnpm exec vitest run src/server/services/__tests__/ingest.db.test.ts
 */
import { config } from "dotenv"
import { and, eq } from "drizzle-orm"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
config({ path: ".env.local", quiet: true })

const RUN = process.env.RUN_DB_TESTS === "1"

const { db } = await import("@/server/db")
const schema = await import("@/server/db/schema")
const { isReferralCodeTaken, recordClick } = await import("../tracking")
const { identifyCustomer } = await import("../identify")
const { resolvePublishableKey } = await import("../api-keys")
const { generateApiKey } = await import("@/lib/crypto/hash")

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

const visitor = () => `v_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`

/** A Sandbox workspace (no subscription) with a test program and a live one, each with an approved affiliate. */
async function fixture(tx: Tx) {
  const suffix = crypto.randomUUID().slice(0, 8)
  const [ws] = await tx
    .insert(schema.workspaces)
    .values({ name: `Ingest ${suffix}`, slug: `ingest-${suffix}`, defaultCurrency: "BRL" })
    .returning({ id: schema.workspaces.id })
  const workspaceId = ws!.id

  const program = async (environment: "test" | "live", status: "active" | "paused" = "active", slug: string = environment) => {
    const [row] = await tx
      .insert(schema.programs)
      .values({
        workspaceId,
        name: slug,
        slug: `${slug}-${suffix}`,
        status,
        environment,
        commissionType: "percentage",
        commissionValue: 3000,
        attributionModel: "last_click",
        currency: "BRL",
      })
      .returning({ id: schema.programs.id })
    return row!.id
  }

  const participation = async (programId: string, code: string) => {
    const [affiliate] = await tx
      .insert(schema.affiliates)
      .values({ workspaceId, email: `${code}-${crypto.randomUUID()}@example.com`, name: code, status: "active" })
      .returning({ id: schema.affiliates.id })
    const [row] = await tx
      .insert(schema.programAffiliates)
      .values({ programId, affiliateId: affiliate!.id, code, status: "approved" })
      .returning({ id: schema.programAffiliates.id })
    return row!.id
  }

  const click = (environment: "test" | "live", code: string, visitorId: string) =>
    recordClick(
      { workspaceId, environment, code, visitorId, landingUrl: `https://example.com/?ref=${code}` },
      tx,
    )

  const attribution = async (programId: string, visitorId: string) => {
    const [row] = await tx
      .select()
      .from(schema.attributions)
      .where(and(eq(schema.attributions.programId, programId), eq(schema.attributions.visitorId, visitorId)))
    return row ?? null
  }

  return { workspaceId, suffix, program, participation, click, attribution }
}

describe.runIf(RUN)("publishable keys", () => {
  it("resolve to their workspace and environment; revoked, secret and mislabelled keys do not", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const insertKey = async (type: "publishable" | "secret", environment: "test" | "live", revoked = false, stored = environment) => {
        const key = generateApiKey(type, environment)
        await tx.insert(schema.apiKeys).values({
          workspaceId: f.workspaceId,
          name: "k",
          type,
          environment: stored,
          keyPrefix: key.prefix,
          keyHash: key.hash,
          revokedAt: revoked ? new Date() : null,
        })
        return key.plaintext
      }

      expect(await resolvePublishableKey(await insertKey("publishable", "test"), tx)).toEqual({
        workspaceId: f.workspaceId,
        environment: "test",
      })
      expect(await resolvePublishableKey(await insertKey("publishable", "live"), tx)).toMatchObject({ environment: "live" })
      // Rotated: the old key stops recording clicks at once.
      expect(await resolvePublishableKey(await insertKey("publishable", "test", true), tx)).toBeNull()
      expect(await resolvePublishableKey(await insertKey("secret", "test"), tx)).toBeNull()
      // A `pk_live_` key whose row says test is not trusted either way.
      expect(await resolvePublishableKey(await insertKey("publishable", "live", false, "test"), tx)).toBeNull()
      expect(await resolvePublishableKey("pk_test_short", tx)).toBeNull()
    })
  }, 60_000)
})

describe.runIf(RUN)("recordClick", () => {
  it("reaches only programs of the key's environment, and records nothing live without live mode", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const live = await f.program("live")
      await f.participation(live, `l${f.suffix}`)

      // The code exists only in the live program: a test key does not see it.
      await expect(f.click("test", `l${f.suffix}`, visitor())).rejects.toMatchObject({ code: "not_found" })

      // Sandbox: a live click is refused before anything is written.
      const v = visitor()
      expect(await f.click("live", `l${f.suffix}`, v)).toEqual({ recorded: false, reason: "live_mode_inactive" })
      const clicks = await tx.select().from(schema.referralClicks).where(eq(schema.referralClicks.visitorId, v))
      expect(clicks).toHaveLength(0)

      // With a live subscription the same click is recorded.
      await tx.insert(schema.workspaceSubscriptions).values({ workspaceId: f.workspaceId, plan: "launch", status: "active", provider: "manual" })
      expect(await f.click("live", `l${f.suffix}`, v)).toMatchObject({ recorded: true, attributionAction: "create" })
    })
  }, 60_000)

  it("resolves a code shared by two programs deterministically: the active program first", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const code = `s${f.suffix}`
      const active = await f.program("test", "active", "older-active")
      await f.participation(active, code)
      const paused = await f.program("test", "paused", "newer-paused")
      await f.participation(paused, code)

      for (let i = 0; i < 3; i += 1) {
        expect(await f.click("test", code, visitor())).toMatchObject({ programId: active })
      }

      // New codes should be unique per workspace and environment.
      const live = await f.program("live")
      expect(await isReferralCodeTaken(tx, paused, code)).toBe(true)
      expect(await isReferralCodeTaken(tx, live, code)).toBe(false)
      expect(await isReferralCodeTaken(tx, active, `free${f.suffix}`)).toBe(false)
    })
  }, 60_000)

  it("never moves an attribution already bound to a customer to another affiliate", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const program = await f.program("test")
      const first = await f.participation(program, `a${f.suffix}`)
      await f.participation(program, `b${f.suffix}`)
      const v = visitor()

      await f.click("test", `a${f.suffix}`, v)
      await identifyCustomer({ workspaceId: f.workspaceId, environment: "test", visitorId: v, externalId: `user_${f.suffix}` }, tx)

      // Last click by another affiliate, after the customer converted.
      expect(await f.click("test", `b${f.suffix}`, v)).toMatchObject({ programAffiliateId: first, attributionAction: "touch" })
      const row = await f.attribution(program, v)
      expect(row!.programAffiliateId).toBe(first)
      expect(row!.customerExternalId).toBe(`user_${f.suffix}`)
    })
  }, 60_000)
})

describe.runIf(RUN)("identifyCustomer", () => {
  it("attaches the founder's id to a customer Stripe created first, and never clears stored ids", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const cus = `cus_${f.suffix}`
      // What a webhook writes before identify ever runs.
      const [stripeFirst] = await tx
        .insert(schema.customers)
        .values({ workspaceId: f.workspaceId, environment: "test", provider: "stripe", providerCustomerId: cus })
        .returning({ id: schema.customers.id })

      const identified = await identifyCustomer(
        { workspaceId: f.workspaceId, environment: "test", visitorId: visitor(), externalId: `u_${f.suffix}`, providerCustomerId: cus, email: "ana@example.com" },
        tx,
      )
      expect(identified.customerId).toBe(stripeFirst!.id)

      // Re-identify without the provider id or the e-mail: both stay.
      await identifyCustomer({ workspaceId: f.workspaceId, environment: "test", visitorId: visitor(), externalId: `u_${f.suffix}` }, tx)
      const rows = await tx.select().from(schema.customers).where(eq(schema.customers.workspaceId, f.workspaceId))
      expect(rows).toHaveLength(1)
      expect(rows[0]!.externalId).toBe(`u_${f.suffix}`)
      expect(rows[0]!.providerCustomerId).toBe(cus)
      expect(rows[0]!.emailHash).not.toBeNull()

      // The same external id in live is a different customer.
      await tx.insert(schema.workspaceSubscriptions).values({ workspaceId: f.workspaceId, plan: "growth", status: "active", provider: "manual" })
      const live = await identifyCustomer({ workspaceId: f.workspaceId, environment: "live", visitorId: visitor(), externalId: `u_${f.suffix}` }, tx)
      expect(live.customerId).not.toBe(stripeFirst!.id)
    })
  }, 60_000)

  it("binds only open attributions of the key's environment", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const test = await f.program("test")
      const live = await f.program("live")
      const testAffiliate = await f.participation(test, `t${f.suffix}`)
      const liveAffiliate = await f.participation(live, `x${f.suffix}`)
      const expiredProgram = await f.program("test", "active", "expired")
      const expiredAffiliate = await f.participation(expiredProgram, `e${f.suffix}`)
      const v = visitor()

      const attribute = (programId: string, programAffiliateId: string, expiresAt: Date) =>
        tx.insert(schema.attributions).values({
          programId,
          programAffiliateId,
          visitorId: v,
          attributionModel: "last_click",
          attributedAt: new Date(),
          expiresAt,
        })
      const future = new Date(Date.now() + 30 * 86_400_000)
      await attribute(test, testAffiliate, future)
      await attribute(live, liveAffiliate, future)
      await attribute(expiredProgram, expiredAffiliate, new Date(Date.now() - 86_400_000))

      const result = await identifyCustomer(
        { workspaceId: f.workspaceId, environment: "test", visitorId: v, externalId: `u_${f.suffix}`, providerCustomerId: `cus_${f.suffix}` },
        tx,
      )
      expect(result.boundAttributions).toBe(1)
      expect((await f.attribution(test, v))!.providerCustomerId).toBe(`cus_${f.suffix}`)
      expect((await f.attribution(live, v))!.customerExternalId).toBeNull()
      expect((await f.attribution(expiredProgram, v))!.customerExternalId).toBeNull()
    })
  }, 60_000)

  it("refuses a live key without live mode (LIVE_MODE_REQUIRED)", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      await expect(
        identifyCustomer({ workspaceId: f.workspaceId, environment: "live", visitorId: visitor(), externalId: "u_live" }, tx),
      ).rejects.toMatchObject({ code: "LIVE_MODE_REQUIRED", status: 402 })
    })
  }, 60_000)
})

describe.skipIf(RUN)("ingest against Postgres (skipped)", () => {
  it.skip("set RUN_DB_TESTS=1 to run against the database in .env.local", () => {})
})
