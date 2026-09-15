/**
 * Platform billing ingest (docs/PLANS.md §5–§6) against a real Postgres, with
 * the Stripe API mocked. Every test runs inside a transaction that is rolled
 * back, so nothing persists. Opt-in, because CI has no database:
 *
 *   RUN_DB_TESTS=1 pnpm exec vitest run src/server/services/__tests__/platform-billing.db.test.ts
 */
import { config } from "dotenv"
import { and, eq } from "drizzle-orm"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/logger", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  return { logger: { ...log, child: () => log } }
})
config({ path: ".env.local", quiet: true })

const RUN = process.env.RUN_DB_TESTS === "1"

const { db } = await import("@/server/db")
const schema = await import("@/server/db/schema")
const { ingestPlatformBillingEvent } = await import("../platform-billing")
const { getWorkspaceEntitlements } = await import("../entitlements")

import type {
  PlatformBillingEvent,
  PlatformBillingGateway,
  PlatformEventAction,
  PlatformSubscriptionUpdate,
} from "@/lib/platform-billing/stripe/types"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
const ROLLBACK = new Error("rollback")

const T0 = new Date("2026-09-01T12:00:00Z")
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000)
const PERIOD_END = new Date("2026-10-01T12:00:00Z")

async function inRollback(fn: (tx: Tx) => Promise<void>) {
  await expect(
    db.transaction(async (tx) => {
      await fn(tx)
      throw ROLLBACK
    }),
  ).rejects.toBe(ROLLBACK)
}

function gatewayReturning(retrieve: PlatformBillingGateway["retrieveSubscription"]): PlatformBillingGateway {
  return {
    prices: { launch: "price_launch", growth: "price_growth" },
    retrieveSubscription: vi.fn(retrieve),
    createCheckoutSession: vi.fn(),
    createPortalSession: vi.fn(),
  }
}

async function fixture(tx: Tx) {
  const suffix = crypto.randomUUID().slice(0, 8)
  const [ws] = await tx
    .insert(schema.workspaces)
    .values({ name: `PB ${suffix}`, slug: `pb-${suffix}`, defaultCurrency: "BRL" })
    .returning({ id: schema.workspaces.id })
  const workspaceId = ws!.id
  const subscriptionId = `sub_${suffix}`
  const customerId = `cus_${suffix}`

  const subscription = (fields: Partial<PlatformSubscriptionUpdate> & { eventCreatedAt: Date }): PlatformSubscriptionUpdate => ({
    workspaceId,
    providerCustomerId: customerId,
    providerSubscriptionId: subscriptionId,
    priceId: "price_launch",
    plan: "launch",
    status: "active",
    currentPeriodStart: T0,
    currentPeriodEnd: PERIOD_END,
    cancelAtPeriodEnd: false,
    trialStart: null,
    trialEnd: null,
    cancelledAt: null,
    ...fields,
  })

  const event = (type: string, createdAt: Date, action: PlatformEventAction, id = `evt_${crypto.randomUUID()}`): PlatformBillingEvent => ({
    providerEventId: id,
    eventType: type,
    createdAt,
    environment: "test",
    payloadHash: "0".repeat(64),
    action,
  })

  const ingest = (e: PlatformBillingEvent, gateway: PlatformBillingGateway | null = null) =>
    ingestPlatformBillingEvent(e, { client: tx, gateway })

  const row = async () => {
    const [found] = await tx
      .select()
      .from(schema.workspaceSubscriptions)
      .where(eq(schema.workspaceSubscriptions.workspaceId, workspaceId))
    return found ?? null
  }

  const claim = async (providerEventId: string) => {
    const [found] = await tx
      .select()
      .from(schema.webhookEvents)
      .where(and(eq(schema.webhookEvents.scope, "platform_billing"), eq(schema.webhookEvents.providerEventId, providerEventId)))
    return found!
  }

  const entitlements = (now: Date) => getWorkspaceEntitlements(tx, workspaceId, now)

  return { workspaceId, subscriptionId, customerId, subscription, event, ingest, row, claim, entitlements }
}

describe.runIf(RUN)("platform billing ingest against Postgres", () => {
  it("checkout.session.completed fetches the subscription and activates Launch", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      expect((await f.entitlements(at(0))).plan).toBe("sandbox")

      const gateway = gatewayReturning(async (_id, createdAt) => f.subscription({ workspaceId: null, eventCreatedAt: createdAt }))
      const result = await f.ingest(
        f.event("checkout.session.completed", at(1), {
          kind: "sync",
          subscriptionId: f.subscriptionId,
          workspaceId: f.workspaceId,
          providerCustomerId: f.customerId,
        }),
        gateway,
      )

      expect(result).toEqual({ status: "processed" })
      expect(gateway.retrieveSubscription).toHaveBeenCalledWith(f.subscriptionId, at(1))
      expect(await f.row()).toMatchObject({
        plan: "launch",
        status: "active",
        provider: "stripe",
        providerCustomerId: f.customerId,
        providerSubscriptionId: f.subscriptionId,
        providerPriceId: "price_launch",
        currentPeriodEnd: PERIOD_END,
        pastDueSince: null,
        providerEventAt: at(1),
      })
      const entitlements = await f.entitlements(at(2))
      expect(entitlements).toMatchObject({ plan: "launch", standing: "active" })
      expect(entitlements.capabilities.features.liveMode).toBe(true)
    })
  }, 30_000)

  it("subscription.updated to the Growth price switches the plan; an older event never overwrites it", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      await f.ingest(f.event("customer.subscription.created", at(1), { kind: "apply", update: f.subscription({ eventCreatedAt: at(1) }) }))

      const upgraded = await f.ingest(
        f.event("customer.subscription.updated", at(10), {
          kind: "apply",
          update: f.subscription({ priceId: "price_growth", plan: "growth", eventCreatedAt: at(10) }),
        }),
      )
      expect(upgraded.status).toBe("processed")
      expect((await f.entitlements(at(11))).plan).toBe("growth")

      // A delayed event from before the upgrade arrives last.
      const stale = f.event("customer.subscription.updated", at(5), {
        kind: "apply",
        update: f.subscription({ status: "past_due", eventCreatedAt: at(5) }),
      })
      expect(await f.ingest(stale)).toEqual({ status: "ignored" })
      expect(await f.row()).toMatchObject({ plan: "growth", status: "active", providerEventAt: at(10) })
      expect((await f.claim(stale.providerEventId)).status).toBe("ignored")
    })
  }, 30_000)

  it("invoice.payment_failed sets past_due_since once, keeps the plan in grace, and clears it on recovery", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      await f.ingest(f.event("customer.subscription.created", at(1), { kind: "apply", update: f.subscription({ eventCreatedAt: at(1) }) }))

      const pastDue = gatewayReturning(async (_id, createdAt) => f.subscription({ status: "past_due", eventCreatedAt: createdAt }))
      const sync = { kind: "sync" as const, subscriptionId: f.subscriptionId, workspaceId: f.workspaceId, providerCustomerId: f.customerId }
      expect((await f.ingest(f.event("invoice.payment_failed", at(10), sync), pastDue)).status).toBe("processed")
      expect((await f.row())!.pastDueSince).toEqual(at(10))

      // The subscription.updated that follows keeps the original date.
      await f.ingest(
        f.event("customer.subscription.updated", at(11), { kind: "apply", update: f.subscription({ status: "past_due", eventCreatedAt: at(11) }) }),
      )
      expect((await f.row())!.pastDueSince).toEqual(at(10))
      expect(await f.entitlements(at(60))).toMatchObject({ plan: "launch", standing: "grace" })

      const paid = gatewayReturning(async (_id, createdAt) => f.subscription({ eventCreatedAt: createdAt }))
      expect((await f.ingest(f.event("invoice.paid", at(120), sync), paid)).status).toBe("processed")
      expect(await f.row()).toMatchObject({ status: "active", pastDueSince: null })
    })
  }, 30_000)

  it("subscription.deleted marks the row cancelled and the workspace returns to Sandbox", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      await f.ingest(f.event("customer.subscription.created", at(1), { kind: "apply", update: f.subscription({ eventCreatedAt: at(1) }) }))

      const endedAt = at(30)
      await f.ingest(
        f.event("customer.subscription.deleted", at(30), {
          kind: "apply",
          update: f.subscription({ status: "cancelled", cancelledAt: endedAt, eventCreatedAt: at(30) }),
        }),
      )

      expect(await f.row()).toMatchObject({ status: "cancelled", cancelledAt: endedAt, plan: "launch" })
      const entitlements = await f.entitlements(at(31))
      expect(entitlements).toMatchObject({ plan: "sandbox", subscribedPlan: "sandbox", standing: "sandbox" })
      expect(entitlements.capabilities.features.liveMode).toBe(false)
    })
  }, 30_000)

  it("a failed event is re-processed when Stripe redelivers it; a processed one is a duplicate", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const sync = { kind: "sync" as const, subscriptionId: f.subscriptionId, workspaceId: f.workspaceId, providerCustomerId: f.customerId }
      const delivery = f.event("checkout.session.completed", at(1), sync)

      const down = gatewayReturning(async () => {
        throw new Error("Stripe unavailable")
      })
      expect(await f.ingest(delivery, down)).toEqual({ status: "failed" })
      expect((await f.claim(delivery.providerEventId)).status).toBe("failed")
      expect(await f.row()).toBeNull()

      const up = gatewayReturning(async (_id, createdAt) => f.subscription({ eventCreatedAt: createdAt }))
      expect(await f.ingest(delivery, up)).toEqual({ status: "processed" })
      expect((await f.claim(delivery.providerEventId)).status).toBe("processed")
      expect((await f.row())!.status).toBe("active")

      expect(await f.ingest(delivery, up)).toEqual({ status: "duplicate" })
    })
  }, 30_000)

  it("fails, and writes nothing, for an unknown price or an unresolvable workspace", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)

      const unknownPrice = f.event("customer.subscription.created", at(1), {
        kind: "apply",
        update: f.subscription({ priceId: "price_other", plan: null, eventCreatedAt: at(1) }),
      })
      expect(await f.ingest(unknownPrice)).toEqual({ status: "failed" })
      const claim = await f.claim(unknownPrice.providerEventId)
      expect(claim.status).toBe("failed")
      expect(claim.errorMessage).toContain("unknown price price_other")

      const orphan = f.event("customer.subscription.updated", at(2), {
        kind: "apply",
        update: f.subscription({
          workspaceId: null,
          providerSubscriptionId: `sub_unknown_${crypto.randomUUID()}`,
          providerCustomerId: `cus_unknown_${crypto.randomUUID()}`,
          eventCreatedAt: at(2),
        }),
      })
      expect(await f.ingest(orphan)).toEqual({ status: "failed" })
      expect((await f.claim(orphan.providerEventId)).errorMessage).toContain("no workspace")
      expect(await f.row()).toBeNull()
    })
  }, 30_000)

  it("resolves a metadata-less event by the tracked customer, and ignores a late event for a replaced subscription", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      await f.ingest(f.event("customer.subscription.created", at(1), { kind: "apply", update: f.subscription({ eventCreatedAt: at(1) }) }))

      const byCustomer = await f.ingest(
        f.event("customer.subscription.updated", at(2), {
          kind: "apply",
          update: f.subscription({ workspaceId: null, cancelAtPeriodEnd: true, eventCreatedAt: at(2) }),
        }),
      )
      expect(byCustomer.status).toBe("processed")
      expect(await f.row()).toMatchObject({ cancelAtPeriodEnd: true })
      expect((await f.entitlements(at(3))).endsAt).toEqual(PERIOD_END)

      const old = await f.ingest(
        f.event("customer.subscription.deleted", at(5), {
          kind: "apply",
          update: f.subscription({ providerSubscriptionId: "sub_old_replaced", status: "cancelled", eventCreatedAt: at(5) }),
        }),
      )
      expect(old).toEqual({ status: "ignored" })
      expect(await f.row()).toMatchObject({ status: "active", providerSubscriptionId: f.subscriptionId })
    })
  }, 30_000)
})
