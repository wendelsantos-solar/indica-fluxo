/**
 * The shared webhook claim against a real Postgres. Every test runs inside a
 * transaction that is rolled back. Opt-in, because CI has no database:
 *
 *   RUN_DB_TESTS=1 pnpm exec vitest run src/server/repositories/__tests__/webhook-events.db.test.ts
 */
import { config } from "dotenv"
import { eq } from "drizzle-orm"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
config({ path: ".env.local", quiet: true })

const RUN = process.env.RUN_DB_TESTS === "1"

const { db } = await import("@/server/db")
const schema = await import("@/server/db/schema")
const { claimWebhookEvent, markWebhookEvent } = await import("../webhook-events")

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

function input(providerEventId: string, scope: "customer_billing" | "platform_billing" = "platform_billing") {
  return {
    scope,
    provider: "stripe" as const,
    providerEventId,
    eventType: "invoice.paid",
    payloadHash: "0".repeat(64),
    workspaceId: null,
    environment: "test" as const,
  }
}

async function row(tx: Tx, id: string) {
  const [found] = await tx.select().from(schema.webhookEvents).where(eq(schema.webhookEvents.id, id))
  return found!
}

describe.runIf(RUN)("claimWebhookEvent against Postgres", () => {
  it("claims a new event once; a redelivery is a duplicate", async () => {
    await inRollback(async (tx) => {
      const eventId = `evt_claim_${crypto.randomUUID()}`
      const first = await claimWebhookEvent(tx, input(eventId))
      expect(first.claimed).toBe(true)
      expect(first.id).toBeTruthy()

      expect(await claimWebhookEvent(tx, input(eventId))).toEqual({ claimed: false, id: null })
    })
  }, 30_000)

  it("re-claims a FAILED event, resetting it to received; processed and ignored stay duplicates", async () => {
    await inRollback(async (tx) => {
      const eventId = `evt_retry_${crypto.randomUUID()}`
      const { id } = await claimWebhookEvent(tx, input(eventId))

      await markWebhookEvent(tx, id!, "failed", "boom")
      expect((await row(tx, id!)).status).toBe("failed")

      const retry = await claimWebhookEvent(tx, input(eventId))
      expect(retry).toEqual({ claimed: true, id })
      const reset = await row(tx, id!)
      expect(reset.status).toBe("received")
      expect(reset.errorMessage).toBeNull()
      expect(reset.processedAt).toBeNull()

      await markWebhookEvent(tx, id!, "processed")
      expect(await claimWebhookEvent(tx, input(eventId))).toEqual({ claimed: false, id: null })

      const other = `evt_ignored_${crypto.randomUUID()}`
      const ignored = await claimWebhookEvent(tx, input(other))
      await markWebhookEvent(tx, ignored.id!, "ignored", "unhandled")
      expect((await claimWebhookEvent(tx, input(other))).claimed).toBe(false)
    })
  }, 30_000)

  it("keeps scopes apart: the same event id is claimed once per scope", async () => {
    await inRollback(async (tx) => {
      const eventId = `evt_scope_${crypto.randomUUID()}`
      expect((await claimWebhookEvent(tx, input(eventId, "platform_billing"))).claimed).toBe(true)
      expect((await claimWebhookEvent(tx, input(eventId, "customer_billing"))).claimed).toBe(true)
    })
  }, 30_000)
})
