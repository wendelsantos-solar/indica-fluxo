/**
 * The whole plan journey, end to end, against Postgres: a new founder starts
 * in Sandbox, proves the integration in test mode, buys Launch through the
 * platform-billing webhook, earns and pays live commissions, falls past due,
 * upgrades, downgrades and cancels (docs/PLANS.md).
 *
 * Real services and real route handlers throughout. The only fakes are the
 * Stripe HTTP client of the platform account (subscription retrieve, checkout
 * create) and the invitation e-mail (it would create a real Supabase account).
 * Webhooks are signed exactly as Stripe signs them.
 *
 * Data is committed (services run their own transactions) and removed by the
 * last step, which also checks that nothing is left. Opt-in:
 *
 *   RUN_DB_TESTS=1 pnpm exec vitest run src/server/services/__tests__/plan-journey.e2e.db.test.ts
 */
import { config } from "dotenv"
import { NextRequest } from "next/server"
import Stripe from "stripe"
import { and, eq, inArray, sql } from "drizzle-orm"
import { afterAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
// Never reach Supabase Auth from a test: an invitation e-mail creates a real account.
vi.mock("@/server/services/invite-mail", () => ({
  sendInviteEmail: async () => ({ emailSent: false, skipped: "notConfigured", inviteUrl: "", loginUrl: "" }),
  inviteLinksFor: () => ({ inviteUrl: "", loginUrl: "" }),
}))

/** Refvia's own Stripe account, faked at the HTTP client: what `retrieve` answers is set per step. */
const platform = vi.hoisted(() => ({
  subscription: null as Record<string, unknown> | null,
  retrieve: [] as string[],
  checkouts: [] as Array<Record<string, unknown>>,
}))
vi.mock("@/lib/platform-billing/stripe/client", () => ({
  platformStripe: () => ({
    subscriptions: {
      retrieve: async (id: string) => {
        platform.retrieve.push(id)
        if (!platform.subscription) throw new Error("no subscription staged")
        return platform.subscription
      },
    },
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          platform.checkouts.push(params)
          return { id: "cs_e2e", url: "https://checkout.stripe.test/c/pay/cs_e2e" }
        },
      },
    },
  }),
}))

config({ path: ".env.local", quiet: true })

const RUN = process.env.RUN_DB_TESTS === "1"

// `env()` is parsed lazily and cached on first use; nothing has read it yet.
const PLATFORM_SECRET = "whsec_platform_e2e_journey_0123456789"
const LAUNCH_PRICE = "price_e2e_launch"
const GROWTH_PRICE = "price_e2e_growth"
vi.stubEnv("PLATFORM_STRIPE_SECRET_KEY", "sk_test_platform_e2e")
vi.stubEnv("PLATFORM_STRIPE_WEBHOOK_SECRET", PLATFORM_SECRET)
vi.stubEnv("STRIPE_LAUNCH_PRICE_ID", LAUNCH_PRICE)
vi.stubEnv("STRIPE_GROWTH_PRICE_ID", GROWTH_PRICE)

const { db } = await import("@/server/db")
const schema = await import("@/server/db/schema")
const { createFixtures, errorCode } = await import("./db-fixtures")
const { createWorkspace, claimPendingInvites } = await import("../workspaces")
const { getWorkspaceEntitlements } = await import("../entitlements")
const { getPlanOverview } = await import("../plans")
const { createProgram } = await import("../programs")
const { inviteAffiliate, setParticipationStatus, setCustomRate, createReferralLink } = await import("../affiliates")
const { rotateApiKey } = await import("../api-keys")
const { startStripeIntegration, saveStripeWebhookSecret } = await import("../integrations")
const { simulateTestConversion } = await import("../sandbox")
const { createCheckoutSession } = await import("../platform-billing")
const { createPayoutBatch, markBatchPaid, getPayoutBatchExport } = await import("../payouts")
const { listAuditLog } = await import("../audit")
const { buildPayoutCsv, csvFormatForLocale } = await import("@/features/payouts/csv")
const { POST: track } = await import("@/app/api/track/route")
const { POST: identify } = await import("@/app/api/identify/route")
const { POST: customerWebhook } = await import("@/app/api/webhooks/stripe/[integrationId]/route")
const { POST: platformWebhook } = await import("@/app/api/platform-billing/stripe/webhook/route")

const f = createFixtures("journey")

// ---------------------------------------------------------------------------
// Journey state and helpers
// ---------------------------------------------------------------------------

const run = crypto.randomUUID().replace(/-/g, "").slice(0, 10)
const TEST_SECRET = `whsec_e2e_test_${run}_0123456789`
const LIVE_SECRET = `whsec_e2e_live_${run}_0123456789`
const DAY = 86_400

const s = {
  owner: { id: "", email: "" },
  affiliateUser: { id: "", email: "" },
  workspaceId: "",
  testProgramId: "",
  liveProgramId: "",
  secondLiveProgramId: "",
  testParticipationId: "",
  liveParticipationId: "",
  testCode: `t${run}`,
  liveCode: `l${run}`,
  integrationId: "",
  keys: { pkTest: "", skTest: "", pkLive: "", skLive: "" },
  batchId: "",
  liveOriginalCommissionId: "",
}

/** Every provider id the journey sends, so cleanup can find rows that do not name the workspace. */
const eventIds: string[] = []
const eventId = (label: string) => {
  const id = `evt_e2e_${run}_${label}`
  eventIds.push(id)
  return id
}

/** Platform events are created on one clock, a little in the past, strictly in delivery order unless a step says otherwise. */
const T0 = Math.floor(Date.now() / 1000) - 3600
const PLATFORM_SUBSCRIPTION = `sub_e2e_${run}`
const PLATFORM_CUSTOMER = `cus_e2e_platform_${run}`

const RULE = {
  description: null,
  status: "active" as const,
  commissionType: "percentage" as const,
  commissionValue: 3000,
  commissionDurationMonths: 12,
  attributionModel: "last_click" as const,
  attributionWindowDays: 60,
  commissionHoldDays: 0,
  currency: "BRL",
}
const program = (name: string, environment: "test" | "live") => ({ ...RULE, name: `${name} ${run}`, environment })

const visitor = () => `v_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`

async function entitlements() {
  return getWorkspaceEntitlements(db, s.workspaceId)
}

async function subscriptionRow() {
  const [row] = await db
    .select()
    .from(schema.workspaceSubscriptions)
    .where(eq(schema.workspaceSubscriptions.workspaceId, s.workspaceId))
  return row ?? null
}

async function claimOf(scope: "customer_billing" | "platform_billing", providerEventId: string) {
  const [row] = await db
    .select()
    .from(schema.webhookEvents)
    .where(and(eq(schema.webhookEvents.scope, scope), eq(schema.webhookEvents.providerEventId, providerEventId)))
  return row ?? null
}

function signed(url: string, payload: string, secret: string, extraHeaders: Record<string, string> = {}) {
  const headers = new Headers({ "content-type": "application/json", ...extraHeaders })
  headers.set("stripe-signature", Stripe.webhooks.generateTestHeaderString({ payload, secret }))
  return new NextRequest(url, { method: "POST", headers, body: payload })
}

// --- Customer billing (the founder's own Stripe) ---------------------------

function stripeEvent(id: string, type: string, created: number, livemode: boolean, object: Record<string, unknown>) {
  return JSON.stringify({ id, object: "event", api_version: "2026-08-26.dahlia", type, created, livemode, data: { object } })
}

function invoicePaid(label: string, opts: { livemode: boolean; customer: string; amount: number; created: number; pi: string }) {
  const id = eventId(label)
  return {
    id,
    body: stripeEvent(id, "invoice.paid", opts.created, opts.livemode, {
      id: `in_e2e_${run}_${label}`,
      object: "invoice",
      customer: opts.customer,
      customer_email: null,
      currency: "brl",
      amount_paid: opts.amount,
      payment_intent: opts.pi,
      charge: `ch_${opts.pi.slice(3)}`,
      parent: { subscription_details: { subscription: `sub_e2e_founder_${run}` } },
    }),
  }
}

function refundCreated(label: string, opts: { livemode: boolean; amount: number; created: number; pi: string }) {
  const id = eventId(label)
  return {
    id,
    body: stripeEvent(id, "refund.created", opts.created, opts.livemode, {
      id: `re_e2e_${run}_${label}`,
      object: "refund",
      amount: opts.amount,
      currency: "brl",
      status: "succeeded",
      payment_intent: opts.pi,
      charge: `ch_${opts.pi.slice(3)}`,
    }),
  }
}

async function sendCustomerEvent(body: string, secret: string) {
  const request = signed(`http://localhost/api/webhooks/stripe/${s.integrationId}`, body, secret)
  const response = await customerWebhook(request, { params: Promise.resolve({ integrationId: s.integrationId }) })
  return { status: response.status, json: (await response.json()) as Record<string, unknown> }
}

// --- Platform billing (Refvia's Stripe) -------------------------------

function platformSubscription(price: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id: PLATFORM_SUBSCRIPTION,
    object: "subscription",
    customer: PLATFORM_CUSTOMER,
    status,
    cancel_at_period_end: false,
    metadata: { workspace_id: s.workspaceId },
    trial_start: null,
    trial_end: null,
    canceled_at: null,
    ended_at: null,
    items: {
      object: "list",
      data: [
        {
          id: `si_e2e_${run}`,
          object: "subscription_item",
          price: { id: price, object: "price" },
          quantity: 1,
          current_period_start: T0,
          current_period_end: T0 + 30 * DAY,
        },
      ],
    },
    ...extra,
  }
}

async function sendPlatformEvent(label: string, type: string, createdOffset: number, object: Record<string, unknown>) {
  const id = eventId(label)
  const body = stripeEvent(id, type, T0 + createdOffset, false, object)
  const response = await platformWebhook(signed("http://localhost/api/platform-billing/stripe/webhook", body, PLATFORM_SECRET))
  return { id, status: response.status, json: (await response.json()) as Record<string, unknown> }
}

// --- Tracking and identify through their routes ----------------------------

async function trackClick(publicKey: string, ref: string, visitorId: string) {
  const response = await track(
    new NextRequest("http://localhost/api/track", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify({ publicKey, ref, visitorId, url: `https://product.example/?ref=${ref}` }),
    }),
  )
  return { status: response.status, json: response.status === 204 ? null : ((await response.json()) as Record<string, unknown>) }
}

async function identifyVisitor(secretKey: string, body: Record<string, unknown>) {
  const response = await identify(
    new NextRequest("http://localhost/api/identify", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secretKey}`, "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify(body),
    }),
  )
  return { status: response.status, json: (await response.json()) as Record<string, unknown> }
}

async function commissionsOfProgram(programId: string) {
  return db
    .select()
    .from(schema.commissions)
    .where(eq(schema.commissions.programId, programId))
    .orderBy(schema.commissions.createdAt)
}

async function programsOfWorkspace() {
  return db
    .select({ id: schema.programs.id, environment: schema.programs.environment, status: schema.programs.status })
    .from(schema.programs)
    .where(eq(schema.programs.workspaceId, s.workspaceId))
}

// --- Cleanup --------------------------------------------------------------

/** Rows still pointing at anything this journey created. Every count must be 0 after cleanup. */
async function leftovers() {
  const ws = s.workspaceId || "00000000-0000-0000-0000-000000000000"
  const users = [s.owner.id, s.affiliateUser.id].filter(Boolean)
  const count = async (query: ReturnType<typeof sql>) => {
    const { rows } = await db.execute<{ n: number }>(query)
    return Number(rows[0]?.n ?? 0)
  }
  return {
    workspaces: await count(sql`select count(*)::int as n from workspaces where id = ${ws}::uuid`),
    programs: await count(sql`select count(*)::int as n from programs where workspace_id = ${ws}::uuid`),
    commissions: await count(sql`select count(*)::int as n from commissions where workspace_id = ${ws}::uuid`),
    transactions: await count(sql`select count(*)::int as n from transactions where workspace_id = ${ws}::uuid`),
    customers: await count(sql`select count(*)::int as n from customers where workspace_id = ${ws}::uuid`),
    apiKeys: await count(sql`select count(*)::int as n from api_keys where workspace_id = ${ws}::uuid`),
    integrations: await count(sql`select count(*)::int as n from integrations where workspace_id = ${ws}::uuid`),
    auditLogs: await count(sql`select count(*)::int as n from audit_logs where workspace_id = ${ws}::uuid`),
    subscriptions: await count(
      sql`select count(*)::int as n from workspace_subscriptions where workspace_id = ${ws}::uuid
            or provider_customer_id = ${PLATFORM_CUSTOMER}`,
    ),
    webhookEvents: await count(
      sql`select count(*)::int as n from webhook_events where workspace_id = ${ws}::uuid
            or provider_event_id like ${`evt_e2e_${run}_%`}`,
    ),
    transactionReferences: await count(
      sql`select count(*)::int as n from transaction_references where workspace_id = ${ws}::uuid`,
    ),
    users:
      users.length === 0
        ? 0
        : await count(sql`select count(*)::int as n from auth.users where id in (${sql.join(users.map((id) => sql`${id}::uuid`), sql`, `)})`),
  }
}

let cleaned = false
async function cleanup() {
  if (cleaned) return
  cleaned = true
  if (s.workspaceId) {
    // Rows the fixtures' cleanup does not know: this workspace was made by
    // `createWorkspace`, and webhook claims only `SET NULL` on delete.
    await db.transaction(async (tx) => {
      const ws = sql`(${s.workspaceId}::uuid)`
      await tx.execute(sql`
        delete from payout_item_commissions where payout_item_id in (
          select pi.id from payout_items pi join payout_batches pb on pb.id = pi.payout_batch_id where pb.workspace_id in ${ws})`)
      await tx.execute(sql`delete from payout_items where payout_batch_id in (select id from payout_batches where workspace_id in ${ws})`)
      await tx.execute(sql`delete from payout_batches where workspace_id in ${ws}`)
      await tx.execute(sql`delete from commissions where workspace_id in ${ws}`)
      await tx.execute(sql`delete from transactions where workspace_id in ${ws}`)
      await tx.execute(sql`delete from subscriptions where workspace_id in ${ws}`)
      await tx.execute(sql`delete from customers where workspace_id in ${ws}`)
      await tx.execute(sql`delete from attributions where program_id in (select id from programs where workspace_id in ${ws})`)
      await tx.execute(sql`delete from referral_clicks where program_id in (select id from programs where workspace_id in ${ws})`)
      await tx.execute(sql`
        delete from referral_links where program_affiliate_id in (
          select pa.id from program_affiliates pa join programs p on p.id = pa.program_id where p.workspace_id in ${ws})`)
      await tx.execute(sql`delete from program_affiliates where program_id in (select id from programs where workspace_id in ${ws})`)
      await tx.execute(sql`delete from affiliates where workspace_id in ${ws}`)
      await tx.execute(sql`delete from programs where workspace_id in ${ws}`)
      await tx.execute(sql`delete from workspaces where id in ${ws}`)
    })
  }
  if (eventIds.length > 0) {
    await db.delete(schema.webhookEvents).where(inArray(schema.webhookEvents.providerEventId, eventIds))
  }
  await f.cleanup()
}

// ---------------------------------------------------------------------------
// The journey
// ---------------------------------------------------------------------------

describe.runIf(RUN)("plan journey: Sandbox → Launch → past due → Growth → Launch → cancelled", () => {
  afterAll(async () => {
    await cleanup()
    vi.unstubAllEnvs()
  }, 120_000)

  it("1. a new user's new workspace has no subscription row and is Sandbox, without live mode", async () => {
    s.owner = await f.user()
    const created = await createWorkspace(s.owner.id, { name: `Journey ${run}`, defaultCurrency: "BRL", timezone: "America/Sao_Paulo" })
    s.workspaceId = created.id

    expect(await subscriptionRow()).toBeNull()
    const e = await entitlements()
    expect(e).toMatchObject({ plan: "sandbox", subscribedPlan: "sandbox", standing: "sandbox", canCreate: true })
    expect(e.capabilities.features.liveMode).toBe(false)
  }, 60_000)

  it("2. a test program is created; a live one needs live mode", async () => {
    const created = await createProgram(s.owner.id, s.workspaceId, program("Test", "test"))
    s.testProgramId = created.id
    const [row] = await db.select().from(schema.programs).where(eq(schema.programs.id, created.id))
    expect(row).toMatchObject({ environment: "test", status: "active", workspaceId: s.workspaceId })

    expect(await errorCode(createProgram(s.owner.id, s.workspaceId, program("Live", "live")))).toBe("LIVE_MODE_REQUIRED")
    expect((await programsOfWorkspace()).map((p) => p.environment)).toEqual(["test"])
  }, 60_000)

  it("3. an invited test affiliate is approved and creates a referral link", async () => {
    s.affiliateUser = await f.user()
    const invited = await inviteAffiliate(
      s.owner.id,
      s.workspaceId,
      { programId: s.testProgramId, name: "Ana Parceira", email: s.affiliateUser.email, code: s.testCode, autoApprove: false },
      "pt-br",
    )
    expect(invited.code).toBe(s.testCode)
    s.testParticipationId = invited.participationId
    const [pending] = await db.select().from(schema.programAffiliates).where(eq(schema.programAffiliates.id, invited.participationId))
    expect(pending!.status).toBe("pending")

    await setParticipationStatus(s.owner.id, s.workspaceId, invited.participationId, "approved")
    const [approved] = await db.select().from(schema.programAffiliates).where(eq(schema.programAffiliates.id, invited.participationId))
    expect(approved!.status).toBe("approved")

    // The affiliate already had an account: signing in claims the invitation.
    await claimPendingInvites(s.affiliateUser.id)
    const [affiliate] = await db.select().from(schema.affiliates).where(eq(schema.affiliates.id, invited.affiliateId))
    expect(affiliate).toMatchObject({ userId: s.affiliateUser.id, status: "active" })

    const link = await createReferralLink(s.affiliateUser.id, invited.participationId, {
      name: `Blog ${run}`,
      destinationUrl: "https://product.example/pricing",
    })
    const [stored] = await db.select().from(schema.referralLinks).where(eq(schema.referralLinks.id, link.id))
    expect(stored).toMatchObject({ programAffiliateId: invited.participationId, destinationUrl: "https://product.example/pricing" })
  }, 60_000)

  it("4. test keys are issued; a live key needs live mode", async () => {
    const pk = await rotateApiKey(s.owner.id, s.workspaceId, "publishable", "test")
    const sk = await rotateApiKey(s.owner.id, s.workspaceId, "secret", "test")
    expect(pk.plaintext.startsWith("pk_test_")).toBe(true)
    expect(sk.plaintext.startsWith("sk_test_")).toBe(true)
    s.keys.pkTest = pk.plaintext
    s.keys.skTest = sk.plaintext

    expect(await errorCode(rotateApiKey(s.owner.id, s.workspaceId, "publishable", "live"))).toBe("LIVE_MODE_REQUIRED")
    expect(await errorCode(rotateApiKey(s.owner.id, s.workspaceId, "secret", "live"))).toBe("LIVE_MODE_REQUIRED")
    const keys = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.workspaceId, s.workspaceId))
    expect(keys.map((k) => `${k.type}:${k.environment}`).sort()).toEqual(["publishable:test", "secret:test"])
  }, 60_000)

  const testVisitor = visitor()
  const TEST_CUSTOMER = `cus_e2e_test_${run}`

  it("5. a click with the test publishable key attributes; identify with the test secret key binds a test customer", async () => {
    const clicked = await trackClick(s.keys.pkTest, s.testCode, testVisitor)
    // The response also carries the public attribution reference, which the
    // tracker takes to the checkout (INTEGRATION_ARCHITECTURE_V2.md §2).
    expect(clicked).toMatchObject({ status: 200, json: { ok: true, attributed: true } })
    expect(clicked.json?.token).toMatch(/^ifx_[A-Za-z0-9_-]+$/)

    const clicks = await db.select().from(schema.referralClicks).where(eq(schema.referralClicks.visitorId, testVisitor))
    expect(clicks).toHaveLength(1)
    expect(clicks[0]!.programId).toBe(s.testProgramId)
    const [attribution] = await db.select().from(schema.attributions).where(eq(schema.attributions.visitorId, testVisitor))
    expect(attribution).toMatchObject({ programId: s.testProgramId, programAffiliateId: s.testParticipationId })

    const identified = await identifyVisitor(s.keys.skTest, {
      visitorId: testVisitor,
      externalId: `user_test_${run}`,
      providerCustomerId: TEST_CUSTOMER,
    })
    expect(identified.status).toBe(200)
    expect(identified.json).toMatchObject({ ok: true, attributionsBound: 1 })

    const [customer] = await db.select().from(schema.customers).where(eq(schema.customers.id, identified.json.customerId as string))
    expect(customer).toMatchObject({ environment: "test", externalId: `user_test_${run}`, providerCustomerId: TEST_CUSTOMER })
    const [bound] = await db.select().from(schema.attributions).where(eq(schema.attributions.visitorId, testVisitor))
    expect(bound).toMatchObject({ customerExternalId: `user_test_${run}`, providerCustomerId: TEST_CUSTOMER })
  }, 60_000)

  it("6. a signed test-mode invoice.paid earns a test commission; the sandbox simulation earns one too", async () => {
    s.integrationId = await startStripeIntegration(s.owner.id, s.workspaceId, `acct_e2e_${run}`)
    await saveStripeWebhookSecret(s.owner.id, s.workspaceId, "test", TEST_SECRET)

    const paid = invoicePaid("test_invoice", {
      livemode: false,
      customer: TEST_CUSTOMER,
      amount: 4900,
      created: Math.floor(Date.now() / 1000),
      pi: `pi_e2e_test_${run}`,
    })
    expect(await sendCustomerEvent(paid.body, TEST_SECRET)).toEqual({ status: 200, json: { received: true } })

    expect(await claimOf("customer_billing", paid.id)).toMatchObject({
      status: "processed",
      environment: "test",
      workspaceId: s.workspaceId,
    })
    const [transaction] = await db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.providerTransactionId, `in_e2e_${run}_test_invoice`))
    expect(transaction).toMatchObject({ environment: "test", type: "payment", grossAmountMinor: 4900, currency: "BRL" })
    const [commission] = await db.select().from(schema.commissions).where(eq(schema.commissions.transactionId, transaction!.id))
    expect(commission).toMatchObject({
      programId: s.testProgramId,
      programAffiliateId: s.testParticipationId,
      commissionAmountMinor: 1470,
      status: "available",
    })

    const simulated = await simulateTestConversion(s.owner.id, s.workspaceId, {
      programId: s.testProgramId,
      participationId: s.testParticipationId,
      amountMinor: 9900,
      simulationId: crypto.randomUUID(),
    })
    expect(simulated.commission).toMatchObject({ amountMinor: 2970, currency: "BRL" })
    expect(await commissionsOfProgram(s.testProgramId)).toHaveLength(2)
  }, 60_000)

  it("7. a live event while in Sandbox is acknowledged, ignored and not claimed", async () => {
    await saveStripeWebhookSecret(s.owner.id, s.workspaceId, "live", LIVE_SECRET)
    const live = invoicePaid("live_while_sandbox", {
      livemode: true,
      customer: `cus_e2e_live_${run}`,
      amount: 9900,
      created: Math.floor(Date.now() / 1000),
      pi: `pi_e2e_sandbox_${run}`,
    })
    expect(await sendCustomerEvent(live.body, LIVE_SECRET)).toEqual({
      status: 200,
      json: { received: true, ignored: "live_mode_inactive" },
    })
    expect(await claimOf("customer_billing", live.id)).toBeNull()
    const liveRows = await db
      .select({ id: schema.transactions.id })
      .from(schema.transactions)
      .where(and(eq(schema.transactions.workspaceId, s.workspaceId), eq(schema.transactions.environment, "live")))
    expect(liveRows).toHaveLength(0)
  }, 60_000)

  it("8. Launch is activated by the platform webhook, never by the checkout redirect", async () => {
    const checkout = await createCheckoutSession(s.owner.id, s.workspaceId, "launch", {
      locale: "pt-br",
      customerEmail: s.owner.email,
      successUrl: "https://app.example/settings?checkout=success",
      cancelUrl: "https://app.example/settings",
    })
    expect(checkout.url).toContain("checkout.stripe.test")
    expect(platform.checkouts[0]).toMatchObject({
      mode: "subscription",
      client_reference_id: s.workspaceId,
      line_items: [{ price: LAUNCH_PRICE, quantity: 1 }],
    })
    // The founder is back on the success URL: nothing has changed yet.
    expect(await subscriptionRow()).toBeNull()
    expect((await entitlements()).plan).toBe("sandbox")

    platform.subscription = platformSubscription(LAUNCH_PRICE, "active")
    const completed = await sendPlatformEvent("checkout_completed", "checkout.session.completed", 1, {
      id: `cs_e2e_${run}`,
      object: "checkout.session",
      mode: "subscription",
      subscription: PLATFORM_SUBSCRIPTION,
      customer: PLATFORM_CUSTOMER,
      client_reference_id: s.workspaceId,
      metadata: { workspace_id: s.workspaceId },
    })
    expect(completed).toMatchObject({ status: 200, json: { received: true } })
    expect(platform.retrieve).toEqual([PLATFORM_SUBSCRIPTION])

    const created = await sendPlatformEvent(
      "subscription_created",
      "customer.subscription.created",
      1,
      platformSubscription(LAUNCH_PRICE, "active"),
    )
    expect(created).toMatchObject({ status: 200, json: { received: true } })
    expect(await claimOf("platform_billing", created.id)).toMatchObject({ status: "processed", workspaceId: null })

    expect(await subscriptionRow()).toMatchObject({
      plan: "launch",
      status: "active",
      provider: "stripe",
      providerSubscriptionId: PLATFORM_SUBSCRIPTION,
      providerCustomerId: PLATFORM_CUSTOMER,
      providerPriceId: LAUNCH_PRICE,
      pastDueSince: null,
    })
    const e = await entitlements()
    expect(e).toMatchObject({ plan: "launch", standing: "active" })
    expect(e.capabilities.features.liveMode).toBe(true)
  }, 60_000)

  it("9. Launch: one live program; the second is refused (upgrade to Growth); custom rates are not included", async () => {
    const live = await createProgram(s.owner.id, s.workspaceId, program("Live", "live"))
    s.liveProgramId = live.id

    const refused = await createProgram(s.owner.id, s.workspaceId, program("Live two", "live")).catch((e: unknown) => e)
    expect(refused).toMatchObject({ code: "PLAN_LIMIT_REACHED", limit: "livePrograms", max: 1, upgradeTo: "growth" })

    // Enrolling the same (already counted) affiliate in the live program.
    const invited = await inviteAffiliate(
      s.owner.id,
      s.workspaceId,
      { programId: s.liveProgramId, name: "Ana Parceira", email: s.affiliateUser.email, code: s.liveCode },
      "pt-br",
    )
    s.liveParticipationId = invited.participationId
    expect(invited.code).toBe(s.liveCode)

    expect(
      await errorCode(setCustomRate(s.owner.id, s.workspaceId, s.liveParticipationId, { type: "percentage", value: 4000 })),
    ).toBe("FEATURE_NOT_AVAILABLE")
    const [participation] = await db.select().from(schema.programAffiliates).where(eq(schema.programAffiliates.id, s.liveParticipationId))
    expect(participation).toMatchObject({ status: "approved", customCommissionType: null })
    expect((await programsOfWorkspace()).filter((p) => p.environment === "live")).toHaveLength(1)
  }, 60_000)

  const liveVisitor = visitor()
  const LIVE_CUSTOMER = `cus_e2e_live_${run}`
  const LIVE_PI = `pi_e2e_live_${run}`

  it("10. live keys, click and identify; live invoice.paid, a renewal a month later, and a partial refund", async () => {
    s.keys.pkLive = (await rotateApiKey(s.owner.id, s.workspaceId, "publishable", "live")).plaintext
    s.keys.skLive = (await rotateApiKey(s.owner.id, s.workspaceId, "secret", "live")).plaintext
    expect(s.keys.pkLive.startsWith("pk_live_")).toBe(true)
    expect(s.keys.skLive.startsWith("sk_live_")).toBe(true)

    // A test key does not see the live code; the live key does.
    expect((await trackClick(s.keys.pkTest, s.liveCode, liveVisitor)).status).toBe(404)
    expect(await trackClick(s.keys.pkLive, s.liveCode, liveVisitor)).toMatchObject({
      status: 200,
      json: { ok: true, attributed: true },
    })
    const identified = await identifyVisitor(s.keys.skLive, {
      visitorId: liveVisitor,
      externalId: `user_live_${run}`,
      providerCustomerId: LIVE_CUSTOMER,
    })
    expect(identified).toMatchObject({ status: 200, json: { ok: true, attributionsBound: 1 } })
    const [customer] = await db.select().from(schema.customers).where(eq(schema.customers.id, identified.json.customerId as string))
    expect(customer!.environment).toBe("live")

    const now = Math.floor(Date.now() / 1000)
    const first = invoicePaid("live_invoice_1", { livemode: true, customer: LIVE_CUSTOMER, amount: 9900, created: now, pi: LIVE_PI })
    expect(await sendCustomerEvent(first.body, LIVE_SECRET)).toEqual({ status: 200, json: { received: true } })
    expect(await claimOf("customer_billing", first.id)).toMatchObject({ status: "processed", environment: "live" })

    let ledger = await commissionsOfProgram(s.liveProgramId)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ commissionAmountMinor: 2970, status: "available", programAffiliateId: s.liveParticipationId })
    s.liveOriginalCommissionId = ledger[0]!.id

    const renewal = invoicePaid("live_invoice_2", {
      livemode: true,
      customer: LIVE_CUSTOMER,
      amount: 9900,
      created: now + 31 * DAY,
      pi: `pi_e2e_live2_${run}`,
    })
    expect(await sendCustomerEvent(renewal.body, LIVE_SECRET)).toEqual({ status: 200, json: { received: true } })
    ledger = await commissionsOfProgram(s.liveProgramId)
    expect(ledger).toHaveLength(2)
    // Paid next month, so not yet eligible.
    expect(ledger[1]).toMatchObject({ commissionAmountMinor: 2970, status: "pending", reversalOfCommissionId: null })
    expect(ledger[1]!.ruleApplied).toContain("12 months")

    const refund = refundCreated("live_refund", { livemode: true, amount: 4950, created: now + 60, pi: LIVE_PI })
    expect(await sendCustomerEvent(refund.body, LIVE_SECRET)).toEqual({ status: 200, json: { received: true } })
    ledger = await commissionsOfProgram(s.liveProgramId)
    expect(ledger).toHaveLength(3)
    const original = ledger.find((row) => row.id === s.liveOriginalCommissionId)
    const reversal = ledger.find((row) => row.reversalOfCommissionId === s.liveOriginalCommissionId)
    // Partial: the original stays, unchanged in amount and still payable; a negative row nets it.
    expect(original).toMatchObject({ commissionAmountMinor: 2970, status: "available" })
    expect(reversal).toMatchObject({ commissionAmountMinor: -1485 })
    const [refundTx] = await db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.providerTransactionId, `re_e2e_${run}_live_refund`))
    expect(refundTx).toMatchObject({ type: "refund", environment: "live", grossAmountMinor: -4950 })
  }, 60_000)

  it("11. a live payout batch pays the live commissions and exports them", async () => {
    // Fast-forward the renewal's hold.
    await db
      .update(schema.commissions)
      .set({ eligibleAt: new Date(Date.now() - 3_600_000) })
      .where(and(eq(schema.commissions.programId, s.liveProgramId), eq(schema.commissions.status, "pending")))

    const periodEnd = new Date()
    const batch = await createPayoutBatch(s.owner.id, s.workspaceId, {
      environment: "live",
      currency: "BRL",
      participationIds: [s.liveParticipationId],
      periodStart: new Date(Date.now() - 31 * DAY * 1000),
      periodEnd,
    })
    s.batchId = batch.id
    expect(batch.totalAmountMinor).toBe(2970 + 2970 - 1485)
    const [stored] = await db.select().from(schema.payoutBatches).where(eq(schema.payoutBatches.id, batch.id))
    expect(stored).toMatchObject({ environment: "live", status: "approved" })
    // Test commissions are never in a live batch.
    expect((await commissionsOfProgram(s.testProgramId)).every((row) => row.status === "available")).toBe(true)

    await markBatchPaid(s.owner.id, s.workspaceId, batch.id, "PIX-E2E")
    const ledger = await commissionsOfProgram(s.liveProgramId)
    expect(ledger.map((row) => row.status)).toEqual(["paid", "paid", "paid"])
    const [paid] = await db.select().from(schema.payoutBatches).where(eq(schema.payoutBatches.id, batch.id))
    expect(paid).toMatchObject({ status: "paid", totalAmountMinor: 4455 })

    const { batch: exported, items } = await getPayoutBatchExport(s.owner.id, s.workspaceId, batch.id)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ amountMinor: 4455, currency: "BRL", commissionCount: 3, affiliateEmail: s.affiliateUser.email })
    const csv = buildPayoutCsv({
      columns: { affiliate: "Afiliado", email: "E-mail", amount: "Valor", currency: "Moeda", commissions: "Comissões", batch: "Lote" },
      rows: items,
      batchLabel: exported.reference,
      format: csvFormatForLocale("pt-br"),
    })
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n")
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe(`Ana Parceira;${s.affiliateUser.email};44,55;BRL;3;${exported.reference}`)
  }, 60_000)

  it("12. past due: grace keeps live mode; beyond seven days creation and live events stop", async () => {
    const pastDue = await sendPlatformEvent(
      "subscription_past_due",
      "customer.subscription.updated",
      10,
      platformSubscription(LAUNCH_PRICE, "past_due"),
    )
    expect(pastDue).toMatchObject({ status: 200, json: { received: true } })
    const row = await subscriptionRow()
    expect(row).toMatchObject({ plan: "launch", status: "past_due" })
    expect(row!.pastDueSince).toEqual(new Date((T0 + 10) * 1000))
    const grace = await entitlements()
    expect(grace).toMatchObject({ plan: "launch", standing: "grace", canCreate: true })
    expect(grace.capabilities.features.liveMode).toBe(true)

    await db
      .update(schema.workspaceSubscriptions)
      .set({ pastDueSince: new Date(Date.now() - 8 * DAY * 1000) })
      .where(eq(schema.workspaceSubscriptions.workspaceId, s.workspaceId))
    const restricted = await entitlements()
    expect(restricted).toMatchObject({ standing: "restricted", canCreate: false })
    expect(restricted.capabilities.features.liveMode).toBe(false)

    expect(await errorCode(createProgram(s.owner.id, s.workspaceId, program("Blocked", "live")))).toBe("SUBSCRIPTION_REQUIRED")
    expect(await errorCode(createProgram(s.owner.id, s.workspaceId, program("Blocked test", "test")))).toBe("SUBSCRIPTION_REQUIRED")

    const live = invoicePaid("live_while_restricted", {
      livemode: true,
      customer: LIVE_CUSTOMER,
      amount: 9900,
      created: Math.floor(Date.now() / 1000),
      pi: `pi_e2e_restricted_${run}`,
    })
    expect(await sendCustomerEvent(live.body, LIVE_SECRET)).toEqual({
      status: 200,
      json: { received: true, ignored: "live_mode_inactive" },
    })
    expect(await claimOf("customer_billing", live.id)).toBeNull()
    expect(await commissionsOfProgram(s.liveProgramId)).toHaveLength(3)
  }, 60_000)

  it("13. recovered, then upgraded to Growth; an older Launch event delivered late changes nothing", async () => {
    const recovered = await sendPlatformEvent(
      "subscription_recovered",
      "customer.subscription.updated",
      20,
      platformSubscription(LAUNCH_PRICE, "active"),
    )
    expect(recovered.status).toBe(200)
    expect(await subscriptionRow()).toMatchObject({ plan: "launch", status: "active", pastDueSince: null })
    expect(await entitlements()).toMatchObject({ plan: "launch", standing: "active" })

    const upgraded = await sendPlatformEvent(
      "subscription_growth",
      "customer.subscription.updated",
      30,
      platformSubscription(GROWTH_PRICE, "active"),
    )
    expect(upgraded).toMatchObject({ status: 200, json: { received: true } })
    expect(await subscriptionRow()).toMatchObject({ plan: "growth", providerPriceId: GROWTH_PRICE })

    const stale = await sendPlatformEvent(
      "subscription_stale_launch",
      "customer.subscription.updated",
      25,
      platformSubscription(LAUNCH_PRICE, "active"),
    )
    expect(stale).toMatchObject({ status: 200, json: { received: true, ignored: true } })
    expect(await claimOf("platform_billing", stale.id)).toMatchObject({ status: "ignored" })
    expect(await subscriptionRow()).toMatchObject({
      plan: "growth",
      providerPriceId: GROWTH_PRICE,
      providerEventAt: new Date((T0 + 30) * 1000),
    })
    expect((await entitlements()).plan).toBe("growth")
  }, 60_000)

  it("14. Growth: a second live program, a custom affiliate rate and the audit log", async () => {
    const second = await createProgram(s.owner.id, s.workspaceId, program("Live two", "live"))
    s.secondLiveProgramId = second.id

    await setCustomRate(s.owner.id, s.workspaceId, s.liveParticipationId, { type: "percentage", value: 4000 })
    const [participation] = await db.select().from(schema.programAffiliates).where(eq(schema.programAffiliates.id, s.liveParticipationId))
    expect(participation).toMatchObject({ customCommissionType: "percentage", customCommissionValue: 4000 })

    const audit = await listAuditLog(s.owner.id, s.workspaceId)
    const actions = audit.map((entry) => entry.action)
    expect(actions).toEqual(expect.arrayContaining(["workspace.created", "program.created", "affiliate.rate_changed", "payout.marked_paid"]))
  }, 60_000)

  it("15. downgraded to Launch: over the live-program limit, nothing deleted, nothing new", async () => {
    const downgraded = await sendPlatformEvent(
      "subscription_downgrade",
      "customer.subscription.updated",
      40,
      platformSubscription(LAUNCH_PRICE, "active"),
    )
    expect(downgraded).toMatchObject({ status: 200, json: { received: true } })
    expect(await subscriptionRow()).toMatchObject({ plan: "launch", status: "active" })

    // As Settings reads it: under RLS. The usage function counts nothing for a non-member (the service connection).
    const status = await getPlanOverview(s.owner.id, s.workspaceId)
    expect(status.entitlements.plan).toBe("launch")
    expect(status.usage.livePrograms).toBe(2)
    expect(status.overLimit).toContain("livePrograms")

    const programs = await programsOfWorkspace()
    expect(programs.filter((p) => p.environment === "live" && p.status === "active").map((p) => p.id).sort()).toEqual(
      [s.liveProgramId, s.secondLiveProgramId].sort(),
    )
    expect(await errorCode(createProgram(s.owner.id, s.workspaceId, program("Live three", "live")))).toBe("PLAN_LIMIT_REACHED")
  }, 60_000)

  it("16. cancelled: back to Sandbox with every row intact; live events are ignored again", async () => {
    const before = {
      programs: (await programsOfWorkspace()).length,
      live: (await commissionsOfProgram(s.liveProgramId)).length,
      test: (await commissionsOfProgram(s.testProgramId)).length,
    }
    const ended = T0 + 50
    const deleted = await sendPlatformEvent(
      "subscription_deleted",
      "customer.subscription.deleted",
      50,
      platformSubscription(LAUNCH_PRICE, "canceled", { canceled_at: ended, ended_at: ended }),
    )
    expect(deleted).toMatchObject({ status: 200, json: { received: true } })
    expect(await subscriptionRow()).toMatchObject({ status: "cancelled", cancelledAt: new Date(ended * 1000) })

    const e = await entitlements()
    expect(e).toMatchObject({ plan: "sandbox", standing: "sandbox" })
    expect(e.capabilities.features.liveMode).toBe(false)

    expect({
      programs: (await programsOfWorkspace()).length,
      live: (await commissionsOfProgram(s.liveProgramId)).length,
      test: (await commissionsOfProgram(s.testProgramId)).length,
    }).toEqual(before)
    const [batch] = await db.select().from(schema.payoutBatches).where(eq(schema.payoutBatches.id, s.batchId))
    expect(batch!.status).toBe("paid")

    const live = invoicePaid("live_after_cancel", {
      livemode: true,
      customer: LIVE_CUSTOMER,
      amount: 9900,
      created: Math.floor(Date.now() / 1000),
      pi: `pi_e2e_cancelled_${run}`,
    })
    expect(await sendCustomerEvent(live.body, LIVE_SECRET)).toEqual({
      status: 200,
      json: { received: true, ignored: "live_mode_inactive" },
    })
    expect(await claimOf("customer_billing", live.id)).toBeNull()
    // A live click records nothing either.
    expect((await trackClick(s.keys.pkLive, s.liveCode, visitor())).status).toBe(204)
  }, 60_000)

  it("17. cleanup removes every row the journey created", async () => {
    const before = await leftovers()
    expect(before.workspaces).toBe(1)
    expect(before.webhookEvents).toBeGreaterThan(0)

    await cleanup()

    const after = await leftovers()
    expect(Object.values(after).every((n) => n === 0), JSON.stringify(after)).toBe(true)
  }, 120_000)
})
