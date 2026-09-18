/**
 * Universal attribution + N billing connectors, against a real Postgres
 * (UNIVERSAL_ATTRIBUTION_ARCHITECTURE.md, brief §78–§79). One Customer, many
 * providers; the attribution follows the customer, not the provider.
 *
 * Part A runs inside a transaction that is rolled back. Part B drives the real
 * ingest path and services, which open their own transactions, on committed
 * fixtures that are deleted afterwards. Opt-in, because CI has no database:
 *
 *   RUN_DB_TESTS=1 pnpm exec vitest run src/server/services/__tests__/multi-provider.db.test.ts
 */
import { config } from "dotenv"
import { and, eq, sql } from "drizzle-orm"
import { afterAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
config({ path: ".env.local", quiet: true })
// The development database is remote: each statement is a round trip.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 })

const RUN = process.env.RUN_DB_TESTS === "1"

const { db, withUser } = await import("@/server/db")
const schema = await import("@/server/db/schema")
const { handleBillingEvent, ingestVerifiedWebhook } = await import("../billing-events")
const { issueAttributionToken } = await import("../attribution-bridge")
const { identifyCustomer } = await import("../identify")
const {
  connectApiProvider,
  disconnectBillingConnection,
  listBillingConnections,
  saveBillingSelection,
  getBillingSelection,
  noteConnectionAccount,
  saveConnectionWebhookSecret,
} = await import("../billing-connections")
const { getStripeSetup, saveStripeWebhookSecret, startStripeIntegration } = await import("../integrations")
const { connectionDisplayState, connectionPresence } = await import("@/features/integrations/health")
const { deriveStripeState } = await import("@/features/integrations/stripe-status")
const { getIntegrationOverview, diagnoseRecentPayments } = await import("../connection-health")
const { createFixtures, errorCode } = await import("./db-fixtures")

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Event = Parameters<typeof handleBillingEvent>[1]
type Provider = "stripe" | "mercado_pago" | "abacatepay" | "asaas"

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

/** A workspace, a 30% BRL test program with a 60-day window, one approved affiliate. */
async function fixture(tx: Tx, options: { participation?: "approved" | "suspended" } = {}) {
  const suffix = crypto.randomUUID().slice(0, 8)
  const [ws] = await tx
    .insert(schema.workspaces)
    .values({ name: `MP ${suffix}`, slug: `mp-${suffix}`, defaultCurrency: "BRL" })
    .returning({ id: schema.workspaces.id })
  const workspaceId = ws!.id
  const [program] = await tx
    .insert(schema.programs)
    .values({
      workspaceId,
      name: "P",
      slug: `p-${suffix}`,
      status: "active",
      environment: "test",
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
    .values({
      programId: program!.id,
      affiliateId: affiliate!.id,
      code: `c${suffix}`,
      status: options.participation ?? "approved",
    })
    .returning({ id: schema.programAffiliates.id })

  /** A click → attribution → reference, as `recordClick` leaves them. */
  const referral = async (window: { from?: Date; to?: Date } = {}) => {
    const visitorId = `v_${crypto.randomUUID().replace(/-/g, "")}`
    await tx.insert(schema.attributions).values({
      programId: program!.id,
      programAffiliateId: participation!.id,
      visitorId,
      attributionModel: "last_click",
      attributedAt: window.from ?? new Date("2026-07-01T00:00:00Z"),
      expiresAt: window.to ?? new Date("2026-12-01T00:00:00Z"),
    })
    const { token } = await issueAttributionToken(tx, { workspaceId, environment: "test", visitorId, windowDays: 60 })
    return { visitorId, token: token! }
  }

  /** Signup: the SaaS calls `/api/identify` from its server. */
  const identify = (visitorId: string, externalId: string, extra: { provider?: Provider; providerCustomerId?: string } = {}) =>
    identifyCustomer({ workspaceId, environment: "test", visitorId, externalId, ...extra }, tx)

  const handle = (event: Event, integrationId: string | null = null) =>
    handleBillingEvent(workspaceId, event, NOW, tx, { integrationId })

  const commissions = () =>
    tx
      .select({
        id: schema.commissions.id,
        amount: schema.commissions.commissionAmountMinor,
        status: schema.commissions.status,
        customerId: schema.commissions.customerId,
        reversalOf: schema.commissions.reversalOfCommissionId,
      })
      .from(schema.commissions)
      .where(eq(schema.commissions.workspaceId, workspaceId))

  const customerOf = async (provider: Provider, providerCustomerId: string) => {
    const [row] = await tx
      .select({ customerId: schema.billingIdentities.customerId })
      .from(schema.billingIdentities)
      .where(
        and(
          eq(schema.billingIdentities.workspaceId, workspaceId),
          eq(schema.billingIdentities.provider, provider),
          eq(schema.billingIdentities.providerCustomerId, providerCustomerId),
        ),
      )
    return row?.customerId ?? null
  }

  return { workspaceId, participationId: participation!.id, referral, identify, handle, commissions, customerOf }
}

function paid(
  provider: Provider,
  id: string,
  customer: string | null,
  extra: Partial<Extract<Event, { type: "payment.succeeded" }>> = {},
): Extract<Event, { type: "payment.succeeded" }> {
  return {
    provider,
    providerAccountId: null,
    environment: "test",
    occurredAt: PAID_AT,
    type: "payment.succeeded",
    providerEventId: `evt_${provider}_${id}`,
    rawType: "payment",
    providerTransactionId: id,
    providerReferences: [],
    providerCustomerId: customer,
    providerSubscriptionId: null,
    customerEmail: null,
    currency: "BRL",
    amountMinor: 10_000,
    ...extra,
  }
}

function refunded(
  provider: Provider,
  paymentId: string,
  cumulative: number,
  extra: Partial<Extract<Event, { type: "payment.refunded" }>> = {},
): Extract<Event, { type: "payment.refunded" }> {
  return {
    provider,
    providerAccountId: null,
    environment: "test",
    occurredAt: NOW,
    type: "payment.refunded",
    providerEventId: `evt_${provider}_refund_${paymentId}_${cumulative}`,
    rawType: "refund",
    providerTransactionId: `${paymentId}:refund`,
    paymentReferences: [paymentId],
    providerCustomerId: null,
    currency: "BRL",
    amountMinor: cumulative,
    cumulativeRefundedMinor: cumulative,
    isChargeback: false,
    ...extra,
  }
}

describe.skipIf(!RUN)("Part A — one customer, many providers", () => {
  it("referral → signup → identify → Stripe → commission", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const { visitorId } = await f.referral()
      await f.identify(visitorId, "user_1", { provider: "stripe", providerCustomerId: "cus_S1" })
      const outcome = await f.handle(paid("stripe", "in_1", "cus_S1"))
      expect(outcome).toMatchObject({ status: "processed" })
      expect((await f.commissions()).map((row) => row.amount)).toEqual([3000])
    })
  })

  // PROGRAM_PAUSE_SEMANTICS.md: pausing stops *new* attributions (tracking.ts);
  // referrals made before the pause and customers already attributed keep
  // earning under the program's other rules. Documented as the official rule.
  it("a paused program keeps paying already-attributed customers, and a pre-pause referral still binds at signup", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const attributed = await f.referral()
      await f.identify(attributed.visitorId, "user_paused_1", { provider: "stripe", providerCustomerId: "cus_P1" })
      const clickedBefore = await f.referral()

      await tx.update(schema.programs).set({ status: "paused" }).where(eq(schema.programs.workspaceId, f.workspaceId))

      await f.handle(paid("stripe", "in_p1", "cus_P1"))
      const bound = await f.identify(clickedBefore.visitorId, "user_paused_2", { provider: "stripe", providerCustomerId: "cus_P2" })
      expect(bound.boundAttributions).toBe(1)
      await f.handle(paid("stripe", "in_p2", "cus_P2"))

      expect((await f.commissions()).map((row) => row.amount)).toEqual([3000, 3000])
    })
  })

  it("referral → signup → identify → Mercado Pago (checkoutFields metadata) → commission", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const { visitorId } = await f.referral()
      await f.identify(visitorId, "user_2")
      // The MP payer was never sent to identify: the checkout carried the SaaS's id.
      await f.handle(paid("mercado_pago", "1000001", "900001", { externalCustomerId: "user_2" }))
      expect((await f.commissions()).map((row) => row.amount)).toEqual([3000])
      expect(await f.customerOf("mercado_pago", "900001")).not.toBeNull()
    })
  })

  it("the same customer paying by Stripe and by Mercado Pago is one customer with two commissions", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const { visitorId } = await f.referral()
      await f.identify(visitorId, "user_3", { provider: "stripe", providerCustomerId: "cus_S3" })
      await f.handle(paid("stripe", "in_3", "cus_S3"))
      await f.handle(paid("mercado_pago", "1000003", "900003", { externalCustomerId: "user_3" }))

      const stripeCustomer = await f.customerOf("stripe", "cus_S3")
      expect(stripeCustomer).not.toBeNull()
      expect(await f.customerOf("mercado_pago", "900003")).toBe(stripeCustomer)
      const rows = await f.commissions()
      expect(rows).toHaveLength(2)
      expect(new Set(rows.map((row) => row.customerId))).toEqual(new Set([stripeCustomer]))
    })
  })

  it("provider switch: Stripe first, Mercado Pago later, same attribution — through the reference alone", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const { visitorId, token } = await f.referral()
      await f.identify(visitorId, "user_4")
      // Months later the SaaS moved to Mercado Pago; the checkout carried the
      // same reference (checkoutFields) but no customer id.
      await f.handle(paid("stripe", "in_4", "cus_S4", { attributionToken: token }))
      await f.handle(paid("mercado_pago", "1000004", "900004", { attributionToken: token }))

      const rows = await f.commissions()
      expect(rows).toHaveLength(2)
      expect(await f.customerOf("mercado_pago", "900004")).toBe(await f.customerOf("stripe", "cus_S4"))
    })
  })

  it("guest checkout: a reference and no provider customer still earns", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const { token } = await f.referral()
      const outcome = await f.handle(paid("asaas", "pay_guest_1", null, { attributionToken: token }))
      expect(outcome).toMatchObject({ status: "processed" })
      expect((await f.commissions()).map((row) => row.amount)).toEqual([3000])
    })
  })

  it("a payment with neither customer nor reference stays out of the ledger, as before", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const outcome = await f.handle(paid("asaas", "pay_anon", null))
      expect(outcome).toMatchObject({ status: "ignored", code: "CUSTOMER_NOT_LINKED" })
    })
  })

  it("payment → commission → cumulative partial refund → full refund → reversal", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const { token } = await f.referral()
      await f.handle(paid("mercado_pago", "1000005", "900005", { attributionToken: token }))

      // Partial: 25.00 of 100.00 → a quarter of the commission reversed.
      await f.handle(refunded("mercado_pago", "1000005", 2_500))
      // The same state notified again changes nothing.
      await f.handle(refunded("mercado_pago", "1000005", 2_500, { providerEventId: "evt_again" }))
      let rows = await f.commissions()
      expect(rows.filter((row) => row.reversalOf).map((row) => row.amount)).toEqual([-750])

      // The running total reaches the whole payment.
      await f.handle(refunded("mercado_pago", "1000005", 10_000))
      rows = await f.commissions()
      expect(rows.filter((row) => row.reversalOf).map((row) => row.amount).sort((a, b) => a - b)).toEqual([-2250, -750])
      expect(rows.find((row) => !row.reversalOf)?.status).toBe("reversed")
    })
  })

  it("a duplicate payment event records one transaction and one commission", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const { token } = await f.referral()
      const event = paid("abacatepay", "bill_dup", "cust_dup", { attributionToken: token })
      await f.handle(event)
      await f.handle({ ...event, providerEventId: "log_other_delivery" })
      expect(await f.commissions()).toHaveLength(1)
    })
  })

  it("an unknown customer is an organic payment: recorded, no commission, no error", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const outcome = await f.handle(paid("asaas", "pay_org", "cus_organic"))
      expect(outcome).toMatchObject({ status: "processed", code: "NO_ATTRIBUTION" })
      expect(await f.commissions()).toHaveLength(0)
    })
  })

  it("an expired attribution earns nothing and says why", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const { visitorId } = await f.referral({ from: new Date("2026-05-01T00:00:00Z"), to: new Date("2026-06-01T00:00:00Z") })
      await f.identify(visitorId, "user_exp", { provider: "asaas", providerCustomerId: "cus_exp" }).catch(() => undefined)
      // identify only binds open attributions; bind the expired one the way an old identify did.
      await tx
        .update(schema.attributions)
        .set({ customerExternalId: "user_exp" })
        .where(eq(schema.attributions.visitorId, visitorId))
      const outcome = await f.handle(paid("asaas", "pay_exp", "cus_exp", { externalCustomerId: "user_exp" }))
      expect(outcome).toMatchObject({ status: "processed", code: "ATTRIBUTION_EXPIRED" })
      expect(await f.commissions()).toHaveLength(0)
    })
  })

  it("an attributed customer whose affiliate is suspended earns nothing, with a reason", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx, { participation: "suspended" })
      const { visitorId } = await f.referral()
      await f.identify(visitorId, "user_susp", { provider: "stripe", providerCustomerId: "cus_susp" })
      const outcome = await f.handle(paid("stripe", "in_susp", "cus_susp"))
      expect(outcome).toMatchObject({ status: "processed", code: "AFFILIATE_INACTIVE" })
    })
  })

  it("Stripe customer '123' and Mercado Pago customer '123' never collide", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const { visitorId } = await f.referral()
      await f.identify(visitorId, "user_col", { provider: "stripe", providerCustomerId: "123" })
      // A stranger paying through Mercado Pago with payer id 123.
      const outcome = await f.handle(paid("mercado_pago", "mp_col", "123"))
      expect(outcome).toMatchObject({ status: "processed", code: "NO_ATTRIBUTION" })
      const stripeCustomer = await f.customerOf("stripe", "123")
      const mpCustomer = await f.customerOf("mercado_pago", "123")
      expect(stripeCustomer).not.toBeNull()
      expect(mpCustomer).not.toBeNull()
      expect(mpCustomer).not.toBe(stripeCustomer)
      expect(await f.commissions()).toHaveLength(0)
    })
  })

  it("a reference bound by one customer does not credit a different, unidentified one", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const { token } = await f.referral()
      await f.handle(paid("stripe", "in_first", "cus_first", { attributionToken: token }))
      // A forwarded link: someone else pays through Asaas with the same reference.
      const outcome = await f.handle(paid("asaas", "pay_other", "cus_other", { attributionToken: token }))
      expect(outcome).toMatchObject({ status: "processed", code: "NO_ATTRIBUTION" })
      expect(await f.commissions()).toHaveLength(1)
    })
  })

  it("a renewal reuses the identity: no reference needed on later payments", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx)
      const { token } = await f.referral()
      await f.handle(paid("asaas", "pay_r1", "cus_r", { attributionToken: token, providerSubscriptionId: "sub_r" }))
      await f.handle(paid("asaas", "pay_r2", "cus_r", { providerSubscriptionId: "sub_r" }))
      expect((await f.commissions()).map((row) => row.amount)).toEqual([3000, 3000])
    })
  })
})

// ---------------------------------------------------------------------------
// Part B — the real ingest path, connections and RLS.
// ---------------------------------------------------------------------------

const fx = createFixtures("mprov")
afterAll(async () => {
  if (RUN) await fx.cleanup()
})

function asaasHttp(onRegister?: (body: unknown) => void) {
  return async (url: string, init?: RequestInit) => {
    if (url.endsWith("/webhooks") && init?.method === "POST") {
      onRegister?.(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ id: `wh_${crypto.randomUUID().slice(0, 6)}` }), { status: 200 })
    }
    if (init?.method === "DELETE") return new Response("{}", { status: 200 })
    return new Response("{}", { status: 404 })
  }
}

describe.skipIf(!RUN)("Part B — connections, ingest and isolation", () => {
  it("connects several accounts of one provider, registers each webhook, refuses the same key twice", async () => {
    const owner = await fx.user()
    const workspaceId = await fx.workspace(owner.id, "growth")
    const registered: unknown[] = []

    const a = await connectApiProvider(
      owner.id,
      workspaceId,
      { provider: "asaas", apiKey: "$aact_hmlg_fixture_key_a", displayName: "Loja BR" },
      asaasHttp((body) => registered.push(body)),
    )
    const b = await connectApiProvider(
      owner.id,
      workspaceId,
      { provider: "asaas", apiKey: "$aact_hmlg_fixture_key_b", displayName: "Loja 2" },
      asaasHttp((body) => registered.push(body)),
    )
    expect(a.integrationId).not.toBe(b.integrationId)
    expect(registered).toHaveLength(2)
    expect(String((registered[0] as { url: string }).url)).toContain(`/api/webhooks/billing/asaas/${a.integrationId}`)

    expect(
      await errorCode(
        connectApiProvider(owner.id, workspaceId, { provider: "asaas", apiKey: "$aact_hmlg_fixture_key_a" }, asaasHttp()),
      ),
    ).toBe("billing_duplicate")

    const connections = await listBillingConnections(owner.id, workspaceId)
    expect(connections.filter((row) => row.provider === "asaas" && row.status === "connected")).toHaveLength(2)
    expect(connections.every((row) => row.environment === "test")).toBe(true)

    // Credentials are stored encrypted, never in the clear.
    const [raw] = await db
      .select({ creds: schema.integrations.encryptedCredentials })
      .from(schema.integrations)
      .where(eq(schema.integrations.id, a.integrationId))
    expect(raw?.creds).toBeTruthy()
    expect(raw?.creds).not.toContain("$aact_hmlg_fixture_key_a")

    const audit = await db
      .select({ action: schema.auditLogs.action })
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.workspaceId, workspaceId))
    expect(audit.map((row) => row.action)).toEqual(
      expect.arrayContaining(["integration.connected", "integration.webhook_registered"]),
    )
  })

  it("one provider account holds a test and a live connection; a Stripe account stays one row", async () => {
    const owner = await fx.user()
    const workspaceId = await fx.workspace(owner.id, "growth")
    const mpHttp = async () => new Response(JSON.stringify({ results: [] }), { status: 200 })

    // The same Mercado Pago seller (user id 55555555): a TEST- and an APP_USR- token.
    const test = await connectApiProvider(owner.id, workspaceId, { provider: "mercado_pago", apiKey: "TEST-1111-222222-abcdef-55555555", webhookSecret: "secret-test-1" }, mpHttp)
    const live = await connectApiProvider(owner.id, workspaceId, { provider: "mercado_pago", apiKey: "APP_USR-1111-222222-abcdef-55555555", webhookSecret: "secret-live-1" }, mpHttp)
    expect([test.environment, live.environment]).toEqual(["test", "live"])

    // Both deliveries teach the connection its account; neither blocks the other.
    await noteConnectionAccount(test.integrationId, "55555555")
    await noteConnectionAccount(live.integrationId, "55555555")
    const rows = await db
      .select({ id: schema.integrations.id, account: schema.integrations.providerAccountId, environment: schema.integrations.environment })
      .from(schema.integrations)
      .where(eq(schema.integrations.workspaceId, workspaceId))
    expect(rows.filter((row) => row.account === "55555555").map((row) => row.environment).sort()).toEqual(["live", "test"])

    // The same account and environment twice is still one row.
    const again = await db
      .insert(schema.integrations)
      .values({ workspaceId, provider: "mercado_pago", providerAccountId: "55555555", environment: "live", status: "pending" })
      .then(() => "inserted", (error: { cause?: { code?: string }; code?: string }) => error.cause?.code ?? error.code)
    expect(again).toBe("23505")

    // Stripe spans both modes on one row: the same acct_ connects to the same connection.
    const first = await startStripeIntegration(owner.id, workspaceId, "acct_env_key_1")
    const second = await startStripeIntegration(owner.id, workspaceId, "acct_env_key_1")
    expect(second).toBe(first)
  })

  it("a manual Stripe setup left halfway stays visible, resumes where it stopped, completes and never duplicates", async () => {
    const owner = await fx.user()
    const workspaceId = await fx.workspace(owner.id, "growth")
    const presenceOf = async (id: string) => {
      const row = (await getIntegrationOverview(owner.id, workspaceId)).connections.find((connection) => connection.id === id)!
      return { presence: connectionPresence(row), state: connectionDisplayState(row.health, row.status, connectionPresence(row)) }
    }

    // Step 1 only: account id saved, no signing secret — then the founder leaves.
    const started = await startStripeIntegration(owner.id, workspaceId, "acct_halfway_1", { displayName: "Conta principal" })
    expect(await presenceOf(started)).toEqual({ presence: "setupIncomplete", state: "setupIncomplete" })

    // Coming back resumes at step 2: the account is kept, nothing asks for it again.
    const setup = await getStripeSetup(owner.id, workspaceId, started)
    expect(setup).toMatchObject({ providerAccountId: "acct_halfway_1", secretSaved: false })
    expect(deriveStripeState({ integration: setup, lastEventAt: null, lastEventFailed: false })).toBe("awaitingSecret")

    // "Conectar Stripe" again with the same account resumes the same row.
    expect(await startStripeIntegration(owner.id, workspaceId, "acct_halfway_1")).toBe(started)
    // Another account is another connection (multi-account still works).
    const other = await startStripeIntegration(owner.id, workspaceId, "acct_halfway_2")
    expect(other).not.toBe(started)
    const stripeRows = (await listBillingConnections(owner.id, workspaceId)).filter((row) => row.provider === "stripe")
    expect(stripeRows).toHaveLength(2)

    // Finishing the setup turns it into a normal connection, waiting for its first event.
    await saveStripeWebhookSecret(owner.id, workspaceId, "test", `whsec_${"a".repeat(32)}`, started)
    expect(await presenceOf(started)).toEqual({ presence: "visible", state: "awaitingEvents" })

    // A real disconnect leaves the lists; starting the same account again resumes that row, as unfinished.
    await disconnectBillingConnection(owner.id, workspaceId, started)
    expect((await presenceOf(started)).presence).toBe("hidden")
    expect(await startStripeIntegration(owner.id, workspaceId, "acct_halfway_1")).toBe(started)
    expect(await presenceOf(started)).toEqual({ presence: "setupIncomplete", state: "setupIncomplete" })
  })

  it("Mercado Pago: saving the panel secret is not a false positive — healthy only after a verified notification", async () => {
    const owner = await fx.user()
    const workspaceId = await fx.workspace(owner.id, "growth")
    const mpHttp = async () => new Response(JSON.stringify({ results: [] }), { status: 200 })
    const { integrationId } = await connectApiProvider(owner.id, workspaceId, { provider: "mercado_pago", apiKey: "TEST-1111-222222-abcdef-77777777" }, mpHttp)
    const read = async () => (await getIntegrationOverview(owner.id, workspaceId)).connections.find((row) => row.id === integrationId)!

    const pending = await read()
    expect(pending.status).toBe("pending")
    expect(connectionDisplayState(pending.health, pending.status, connectionPresence(pending))).toBe("connecting")

    // "Já configurei — verificar": the secret is stored, nothing is verified yet.
    await saveConnectionWebhookSecret(owner.id, workspaceId, integrationId, "mp-panel-secret-1")
    const saved = await read()
    expect(saved.health.overall).not.toBe("healthy")
    expect(connectionDisplayState(saved.health, saved.status, connectionPresence(saved))).toBe("awaitingEvents")
  })

  it("a refused key leaves no connection behind; a member cannot connect", async () => {
    const owner = await fx.user()
    const member = await fx.user()
    const workspaceId = await fx.workspace(owner.id, "growth")
    await fx.member(workspaceId, member.id, "member")

    const refused = async () => new Response("{}", { status: 401 })
    expect(
      await errorCode(connectApiProvider(owner.id, workspaceId, { provider: "asaas", apiKey: "$aact_prod_revoked_key" }, refused)),
    ).toBe("billing_invalid_credentials")
    // Not even a hidden row: a failed attempt is not a setup (brief §8).
    expect(await listBillingConnections(owner.id, workspaceId)).toHaveLength(0)

    expect(
      await errorCode(connectApiProvider(member.id, workspaceId, { provider: "asaas", apiKey: "$aact_hmlg_member_key" }, asaasHttp())),
    ).toBe("forbidden")
  })

  it("scopes event ids to the connection, refuses the other environment, and dedups redeliveries", async () => {
    const owner = await fx.user()
    const workspaceId = await fx.workspace(owner.id, "growth")
    const one = await connectApiProvider(owner.id, workspaceId, { provider: "asaas", apiKey: "$aact_hmlg_scope_key_1" }, asaasHttp())
    const two = await connectApiProvider(owner.id, workspaceId, { provider: "asaas", apiKey: "$aact_hmlg_scope_key_2" }, asaasHttp())

    const verified = { providerEventId: "evt_same_id", rawType: "PAYMENT_CREATED", providerAccountId: null, environment: null, payload: {} }
    const ingest = (integrationId: string, environment: "test" | "live" | null = null) =>
      ingestVerifiedWebhook({
        provider: { id: "asaas" },
        verified: { ...verified, environment },
        rawBody: "{}",
        workspaceId,
        integrationId,
        connectionEnvironment: "test",
        normalize: async () => [],
      })

    expect(await ingest(one.integrationId)).toEqual({ status: "ignored" })
    // The same provider id on another account of the same provider is its own event.
    expect(await ingest(two.integrationId)).toEqual({ status: "ignored" })
    // A redelivery is a duplicate.
    expect(await ingest(one.integrationId)).toEqual({ status: "duplicate" })

    const mismatch = await ingestVerifiedWebhook({
      provider: { id: "asaas" },
      verified: { ...verified, providerEventId: "evt_live_on_test", environment: "live" },
      rawBody: "{}",
      workspaceId,
      integrationId: one.integrationId,
      connectionEnvironment: "test",
      normalize: async () => {
        throw new Error("must not normalise a mismatched event")
      },
    })
    expect(mismatch).toEqual({ status: "ignored" })

    const rows = await db
      .select({ id: schema.webhookEvents.providerEventId, reason: schema.webhookEvents.reasonCode })
      .from(schema.webhookEvents)
      .where(eq(schema.webhookEvents.workspaceId, workspaceId))
    expect(rows.map((row) => row.id).sort()).toEqual(
      [`${one.integrationId}:evt_same_id`, `${one.integrationId}:evt_live_on_test`, `${two.integrationId}:evt_same_id`].sort(),
    )
    expect(rows.find((row) => row.id.endsWith("evt_live_on_test"))?.reason).toBe("TEST_LIVE_MISMATCH")
    expect(rows.find((row) => row.id.endsWith("evt_same_id"))?.reason).toBe("UNSUPPORTED_EVENT")
  })

  it("disconnecting stops new events and keeps the ledger", async () => {
    const owner = await fx.user()
    const workspaceId = await fx.workspace(owner.id, "growth")
    const programId = await fx.program(workspaceId)
    const [participation] = await fx.affiliates(workspaceId, programId, 1)
    await fx.commission(workspaceId, programId, participation!.id, 1500)
    const connection = await connectApiProvider(owner.id, workspaceId, { provider: "asaas", apiKey: "$aact_hmlg_disc_key" }, asaasHttp())

    const { webhookRemoved } = await disconnectBillingConnection(owner.id, workspaceId, connection.integrationId, asaasHttp())
    expect(webhookRemoved).toBe(true)

    const [row] = await db
      .select({ status: schema.integrations.status, creds: schema.integrations.encryptedCredentials })
      .from(schema.integrations)
      .where(eq(schema.integrations.id, connection.integrationId))
    expect(row).toEqual({ status: "disconnected", creds: null })
    const ledger = await db.select({ id: schema.commissions.id }).from(schema.commissions).where(eq(schema.commissions.workspaceId, workspaceId))
    expect(ledger).toHaveLength(1)
  })

  it("stores the provider selection for admins and derives health per connection", async () => {
    const owner = await fx.user()
    const workspaceId = await fx.workspace(owner.id, "growth")
    expect(await getBillingSelection(owner.id, workspaceId)).toBeNull()
    await saveBillingSelection(owner.id, workspaceId, ["stripe", "asaas", "asaas"])
    expect(await getBillingSelection(owner.id, workspaceId)).toEqual(["stripe", "asaas"])
    expect(await errorCode(saveBillingSelection(owner.id, workspaceId, ["paypal"]))).toBe("validation_error")

    await connectApiProvider(owner.id, workspaceId, { provider: "asaas", apiKey: "$aact_hmlg_health_key" }, asaasHttp())
    const overview = await getIntegrationOverview(owner.id, workspaceId)
    expect(overview.connections).toHaveLength(1)
    expect(overview.connections[0]?.health.overall).toBe("connecting")
    expect(overview.selection).toEqual(["stripe", "asaas"])
  })

  it("isolates connections, identities, selections and diagnostics per workspace, and from affiliates", async () => {
    const ownerA = await fx.user()
    const ownerB = await fx.user()
    const affiliateUser = await fx.user()
    const wsA = await fx.workspace(ownerA.id, "growth")
    await fx.workspace(ownerB.id, "growth")
    const programA = await fx.program(wsA)
    await fx.linkedAffiliate(wsA, programA, affiliateUser.id)
    await saveBillingSelection(ownerA.id, wsA, ["asaas"])
    const connection = await connectApiProvider(ownerA.id, wsA, { provider: "asaas", apiKey: "$aact_hmlg_rls_key" }, asaasHttp())

    const [customer] = await db
      .insert(schema.customers)
      .values({ workspaceId: wsA, environment: "test", provider: "asaas", providerCustomerId: "cus_rls" })
      .returning({ id: schema.customers.id })
    await db.insert(schema.billingIdentities).values({
      workspaceId: wsA,
      customerId: customer!.id,
      environment: "test",
      provider: "asaas",
      providerCustomerId: "cus_rls",
    })
    await ingestVerifiedWebhook({
      provider: { id: "asaas" },
      verified: { providerEventId: "evt_rls", rawType: "PAYMENT_CREATED", providerAccountId: null, environment: null, payload: {} },
      rawBody: "{}",
      workspaceId: wsA,
      integrationId: connection.integrationId,
      connectionEnvironment: "test",
      normalize: async () => [],
    })

    for (const outsider of [ownerB.id, affiliateUser.id]) {
      const seen = await withUser(outsider, async (tx) => ({
        connections: await tx.select().from(schema.integrations).where(eq(schema.integrations.workspaceId, wsA)),
        identities: await tx.select().from(schema.billingIdentities).where(eq(schema.billingIdentities.workspaceId, wsA)),
        selections: await tx.select().from(schema.billingSetupSelections).where(eq(schema.billingSetupSelections.workspaceId, wsA)),
        events: (await tx.execute(sql`select * from public.billing_connection_events(${wsA}, now() - interval '30 days')`)).rows,
        recent: (await tx.execute(sql`select * from public.billing_connection_recent_events(${wsA}, ${connection.integrationId}, 10)`)).rows,
      }))
      expect(seen).toEqual({ connections: [], identities: [], selections: [], events: [], recent: [] })
    }

    const insider = await withUser(ownerA.id, async (tx) => ({
      identities: await tx.select().from(schema.billingIdentities).where(eq(schema.billingIdentities.workspaceId, wsA)),
      events: (await tx.execute(sql`select * from public.billing_connection_events(${wsA}, now() - interval '30 days')`)).rows,
    }))
    expect(insider.identities).toHaveLength(1)
    expect(insider.events).toHaveLength(1)

    // Members cannot write identities: there is no client write path.
    const write = await withUser(ownerA.id, (tx) =>
      tx
        .insert(schema.billingIdentities)
        .values({ workspaceId: wsA, customerId: customer!.id, environment: "test", provider: "asaas", providerCustomerId: "cus_forged" })
        .then(() => "inserted")
        .catch(() => "refused"),
    )
    expect(write).toBe("refused")
  })

  it("diagnoses an attributed payment that earned nothing apart from an organic one", async () => {
    const owner = await fx.user()
    const workspaceId = await fx.workspace(owner.id, "growth")
    const programId = await fx.program(workspaceId)
    const [participation] = await fx.affiliates(workspaceId, programId, 1, "suspended")
    const visitorId = `v_${crypto.randomUUID().replace(/-/g, "")}`
    await db.insert(schema.attributions).values({
      programId,
      programAffiliateId: participation!.id,
      visitorId,
      attributionModel: "last_click",
      attributedAt: new Date(Date.now() - 5 * 86_400_000),
      expiresAt: new Date(Date.now() + 50 * 86_400_000),
    })
    await identifyCustomer({ workspaceId, environment: "test", visitorId, externalId: "user_diag" })
    const occurredAt = new Date(Date.now() - 86_400_000)
    await handleBillingEvent(workspaceId, paid("asaas", "pay_diag", "cus_diag", { externalCustomerId: "user_diag", occurredAt }))
    await handleBillingEvent(workspaceId, paid("asaas", "pay_organic", "cus_nobody", { occurredAt }))

    const diagnosis = await diagnoseRecentPayments(owner.id, workspaceId)
    const byId = Object.fromEntries(diagnosis.map((row) => [row.providerTransactionId, row]))
    expect(byId.pay_diag?.classification).toBe("expected")
    expect(byId.pay_diag?.steps.commission).toBe("missing")
    expect(byId.pay_organic?.classification).toBe("organic")
    expect(byId.pay_organic?.steps.commission).toBe("notApplicable")
  })
})

// ---------------------------------------------------------------------------
// Part C — the integration wizard, end to end, on the real services and the
// real webhook route (brief §80). No provider is called: the provider's API
// is a mock `fetch`, and the "provider" delivery is built from the documented
// payload and signed with the connection's own token.
// ---------------------------------------------------------------------------

describe.skipIf(!RUN)("Part C — wizard journey", () => {
  it("account → program → affiliate → simulated conversion → choose providers → connect → real event → healthy and ready", async () => {
    const { recordClick } = await import("../tracking")
    const { simulateTestConversion } = await import("../sandbox")
    const { NextRequest } = await import("next/server")
    const { POST } = await import("@/app/api/webhooks/billing/[provider]/[integrationId]/route")
    const { decryptSecret } = await import("@/lib/crypto/secrets")
    const { asaas } = await import("@/lib/billing/__fixtures__/providers")
    const { deriveSetup } = await import("@/features/integrations/setup")

    // 1. Account, program, affiliate.
    const owner = await fx.user()
    const workspaceId = await fx.workspace(owner.id, "growth")
    const programId = await fx.program(workspaceId)
    const code = `wiz${crypto.randomUUID().slice(0, 6)}`
    const [affiliate] = await db
      .insert(schema.affiliates)
      .values({ workspaceId, email: `${code}@example.test`, name: "Wizard affiliate", status: "active" })
      .returning({ id: schema.affiliates.id })
    const [participation] = await db
      .insert(schema.programAffiliates)
      .values({ programId, affiliateId: affiliate!.id, code, status: "approved" })
      .returning({ id: schema.programAffiliates.id })

    // 2. The aha moment: a simulated conversion, no code, no provider.
    const simulated = await simulateTestConversion(owner.id, workspaceId, {
      programId,
      participationId: participation!.id,
      amountMinor: 9_900,
      simulationId: crypto.randomUUID(),
    })
    expect(simulated).toBeTruthy()

    // 3. How does the SaaS get paid? Two providers, one left for later.
    await saveBillingSelection(owner.id, workspaceId, ["asaas", "mercado_pago"])

    // 4. Connect Asaas: one key, the webhook registered by the product.
    let registered: { url: string; authToken: string } | null = null
    const { integrationId } = await connectApiProvider(
      owner.id,
      workspaceId,
      { provider: "asaas", apiKey: "$aact_hmlg_wizard_key_0001", displayName: "Loja BR" },
      asaasHttp((body) => {
        registered = body as { url: string; authToken: string }
      }),
    )
    expect(registered!.url).toContain(`/api/webhooks/billing/asaas/${integrationId}`)

    // 5. A real visitor: the tracker's click, then sign-up, then a sandbox payment.
    const visitorId = `v_${crypto.randomUUID().replace(/-/g, "")}`
    const click = await recordClick({ workspaceId, environment: "test", code, visitorId, landingUrl: "https://saas.example/pricing" })
    expect(click.recorded).toBe(true)
    await identifyCustomer({ workspaceId, environment: "test", visitorId, externalId: "user_wizard" })
    const token = click.recorded ? click.attributionToken : null
    expect(token).toBeTruthy()

    let overview = await getIntegrationOverview(owner.id, workspaceId)
    expect(overview.connections[0]?.health.overall).toBe("connecting")

    // The delivery the provider would send, authenticated by the token it was given.
    const [stored] = await db
      .select({ creds: schema.integrations.encryptedCredentials })
      .from(schema.integrations)
      .where(eq(schema.integrations.id, integrationId))
    const authToken = JSON.parse(decryptSecret(stored!.creds!)).authToken as string
    expect(authToken).toBe(registered!.authToken)
    const payload = asaas.payment("PAYMENT_RECEIVED", {
      id: `pay_${crypto.randomUUID().slice(0, 8)}`,
      customer: `cus_${crypto.randomUUID().slice(0, 8)}`,
      externalReference: token,
      paymentDate: new Date().toISOString().slice(0, 10),
    })
    const response = await POST(
      new NextRequest(`http://localhost/api/webhooks/billing/asaas/${integrationId}`, {
        method: "POST",
        headers: new Headers({ "content-type": "application/json", "asaas-access-token": authToken }),
        body: JSON.stringify(payload),
      }),
      { params: Promise.resolve({ provider: "asaas", integrationId }) },
    )
    expect(response.status).toBe(200)

    // 6. Health and setup, from evidence.
    overview = await getIntegrationOverview(owner.id, workspaceId)
    const connection = overview.connections.find((row) => row.id === integrationId)!
    expect(connection.health.overall).toBe("healthy")
    expect(connection.paymentsWithCommission).toBe(1)

    const setup = deriveSetup({
      trackerDetected: overview.tracker.lastClickAt !== null,
      identityDetected: Boolean(overview.identity.lastIdentifyAt || overview.identity.lastReferenceBoundAt),
      selection: overview.selection,
      connections: overview.connections.map((row) => ({
        provider: row.provider,
        overall: row.health.overall,
        events: row.events,
        payments: row.payments,
      })),
    })
    expect(setup.ready).toBe(true)
    // Mercado Pago, chosen but not connected, is listed and does not block.
    expect(setup.steps.find((step) => step.provider === "mercado_pago")).toMatchObject({ done: false, optional: true })

    const [transaction] = await db
      .select({ integrationId: schema.transactions.integrationId })
      .from(schema.transactions)
      .where(and(eq(schema.transactions.workspaceId, workspaceId), eq(schema.transactions.provider, "asaas")))
      .limit(1)
    expect(transaction?.integrationId).toBe(integrationId)
  })
})
