import "server-only"

import { and, eq, inArray, isNotNull, isNull, ne, notExists, or, sql } from "drizzle-orm"

import { hashEmail, hashPayload } from "@/lib/crypto/hash"
import { logger } from "@/lib/logger"
import { ConnectorFetchError } from "@/lib/billing/connector"
import { attributionCustomerKey, guestCustomerId } from "@/lib/billing/identity-key"
import { EXPECTED_REASONS, type ReasonCode } from "@/lib/billing/reasons"
import type {
  BillingEnvironment,
  BillingProvider,
  BillingProviderId,
  NormalizedBillingEvent,
  VerifiedWebhook,
} from "@/lib/billing/types"
import { db, type Transaction } from "@/server/db"
import { qualified } from "@/server/db/qualify"
import {
  attributions,
  commissions,
  customers,
  integrations,
  programAffiliates,
  programs,
  subscriptions,
  transactionReferences,
  transactions,
} from "@/server/db/schema"
import { calculateCommission, isFullyRefunded, planReversal, shouldRestoreChargeback } from "@/server/domain/commission"
import { toProgramRules } from "@/server/repositories/programs"
import { toParticipationRules } from "@/server/repositories/affiliates"
import { claimWebhookEvent, markWebhookEvent } from "@/server/repositories/webhook-events"

import {
  bindAttributionToken,
  commissionsForBoundCustomer,
  type BindOutcome,
} from "./attribution-bridge"
import { customerByExternalId, customerByIdentity, linkBillingIdentity } from "./billing-identity"
import { commissionForTransaction } from "./commission-writer"

import { canUseFeature, getWorkspaceEntitlements } from "./entitlements"

export type EventOutcome =
  | { status: "duplicate" }
  | { status: "ignored"; reason: string; code?: ReasonCode }
  | { status: "processed"; commissionId?: string; detail: string; code?: ReasonCode }

/** Where an event came from, beyond what the provider said. */
export interface EventContext {
  /** The billing connection that delivered it; `null` for simulations and legacy rows. */
  integrationId?: string | null
}


/**
 * The `ignored` reason of a payment that carried no Stripe customer. Counted by
 * `webhook_payments_without_customer` (migration 0015), which matches this exact
 * string — change both together.
 */
export const PAYMENT_WITHOUT_CUSTOMER = "payment has no customer"

/**
 * A refund or dispute whose payment is not in the ledger yet. Stripe does not
 * order its events, so the payment may simply be a retry behind: the event is
 * marked `failed` and answered with a 500, and Stripe's own retry processes it
 * once the payment is there. If it never arrives, the event stays failed and
 * visible on Integrations.
 */
export class PaymentNotRecordedYetError extends Error {
  constructor(refundId: string) {
    super(`${refundId} references a payment that is not recorded yet; waiting for the provider to retry`)
    this.name = "PaymentNotRecordedYetError"
  }
}

/**
 * Legacy platform endpoint only (`/api/webhooks/stripe`): maps the connected
 * account on a platform-signed event to the workspace that owns it.
 *
 * Per-workspace endpoints (`/api/webhooks/stripe/<integrationId>`) never come
 * through here: the endpoint itself names the workspace, and its signing
 * secret proves the sender.
 */
export async function workspaceForProviderAccount(
  provider: BillingProviderId,
  providerAccountId: string | null,
): Promise<string | null> {
  if (!providerAccountId) {
    // Single-tenant / test mode: fall back to the only connected workspace
    // that still relies on the platform secret. A workspace with its own
    // signing secret receives its events on its own endpoint, so an
    // account-less platform event is never routed to it.
    const rows = await db
      .select({ workspaceId: integrations.workspaceId })
      .from(integrations)
      .where(
        and(
          eq(integrations.provider, provider),
          eq(integrations.status, "connected"),
          isNull(integrations.encryptedCredentials),
        ),
      )
      .limit(2)
    return rows.length === 1 ? rows[0]!.workspaceId : null
  }

  const [row] = await db
    .select({ workspaceId: integrations.workspaceId })
    .from(integrations)
    .where(and(eq(integrations.provider, provider), eq(integrations.providerAccountId, providerAccountId)))
    .limit(1)

  return row?.workspaceId ?? null
}

/**
 * `workspaceForProviderAccount`, plus which connection it is — the legacy
 * platform endpoint uses it so its events are attributed to a connection too.
 */
export async function connectionForProviderAccount(
  provider: BillingProviderId,
  providerAccountId: string | null,
): Promise<{ workspaceId: string; integrationId: string | null } | null> {
  const workspaceId = await workspaceForProviderAccount(provider, providerAccountId)
  if (!workspaceId) return null
  const [row] = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(
      and(
        eq(integrations.workspaceId, workspaceId),
        eq(integrations.provider, provider),
        providerAccountId ? eq(integrations.providerAccountId, providerAccountId) : isNull(integrations.encryptedCredentials),
      ),
    )
    .limit(1)
  return { workspaceId, integrationId: row?.id ?? null }
}

export type IngestResult =
  | { status: "duplicate" }
  | { status: "ignored"; reason?: "live_mode_inactive" }
  | { status: "processed" }
  | { status: "failed" }

/** Workspaces whose skipped live events were logged recently: once an hour each, not per event. */
const liveSkipLoggedAt = new Map<string, number>()
const LIVE_SKIP_LOG_INTERVAL_MS = 60 * 60 * 1000

/**
 * Everything after signature verification, shared by every billing endpoint —
 * Stripe's two and the generic connector route (ARCHITECTURE.md §3.3):
 *   0. a delivery for the other environment than its connection is recorded as
 *      `TEST_LIVE_MISMATCH` and processes nothing
 *   0b. a live event for a workspace without live mode is acknowledged and NOT
 *      claimed — no `webhook_events` row — so it can be re-sent once the plan
 *      is active again (docs/PLANS.md §2)
 *   1. claim (scope, provider, event id): a redelivery of a processed event is
 *      a no-op; a redelivery of a FAILED one is claimed again and retried.
 *      Stripe event ids are globally unique (documented) and are claimed as
 *      they are; every other provider's id is scoped to its connection
 *      (`<integration>:<id>`), because none documents global uniqueness.
 *   2. normalise — to zero, one or several provider-free facts — and hand each
 *      to the domain
 *   3. record how the claim ended, with a reason code
 *
 * `workspaceId` is decided by the caller — from the endpoint's connection, or
 * from `event.account` on the legacy route.
 */
export async function ingestVerifiedWebhook(params: {
  provider: Pick<BillingProvider, "id"> & Partial<Pick<BillingProvider, "normalizeEvent">>
  verified: VerifiedWebhook
  rawBody: string
  workspaceId: string | null
  /** The connection the delivery arrived on. */
  integrationId?: string | null
  /** The connection's own environment (API-key connectors); Stripe connections span both. */
  connectionEnvironment?: BillingEnvironment | null
  /** Connector normalisation (async, plural). Defaults to the Stripe adapter's `normalizeEvent`. */
  normalize?: () => Promise<NormalizedBillingEvent[]>
}): Promise<IngestResult> {
  const { provider, verified, rawBody, workspaceId } = params
  const integrationId = params.integrationId ?? null
  const connectionEnvironment = params.connectionEnvironment ?? null
  const environment = verified.environment ?? connectionEnvironment
  const log = logger.child({ provider: provider.id, eventId: verified.providerEventId, integrationId })
  const mismatched = Boolean(verified.environment && connectionEnvironment && verified.environment !== connectionEnvironment)

  if (!mismatched && workspaceId && environment === "live" && !(await liveModeActive(workspaceId))) {
    const last = liveSkipLoggedAt.get(workspaceId) ?? 0
    if (Date.now() - last > LIVE_SKIP_LOG_INTERVAL_MS) {
      liveSkipLoggedAt.set(workspaceId, Date.now())
      log.warn("live webhook ignored: workspace has no live mode", { workspaceId })
    }
    return { status: "ignored", reason: "live_mode_inactive" }
  }

  const claim = await claimWebhookEvent(db, {
    scope: "customer_billing",
    provider: provider.id,
    providerEventId:
      provider.id === "stripe" || !integrationId
        ? verified.providerEventId
        : `${integrationId}:${verified.providerEventId}`.slice(0, 500),
    eventType: verified.rawType,
    payloadHash: hashPayload(rawBody),
    workspaceId,
    environment,
    integrationId,
  })

  // Already received, processed or ignored by an earlier delivery — acknowledge and stop.
  if (!claim.claimed || !claim.id) {
    log.info("duplicate webhook ignored")
    return { status: "duplicate" }
  }

  if (!workspaceId) {
    await markWebhookEvent(db, claim.id, "ignored", "no workspace for connected account", "NO_CONNECTION")
    log.warn("webhook for an unconnected account")
    return { status: "ignored" }
  }

  if (mismatched) {
    // A test event on a live connection (or the reverse): never processed as
    // the other ledger. Acknowledged, so the provider stops retrying it.
    await markWebhookEvent(db, claim.id, "ignored", "event environment does not match its connection", "TEST_LIVE_MISMATCH")
    log.warn("webhook environment does not match its connection", { workspaceId })
    return { status: "ignored" }
  }

  let normalized: NormalizedBillingEvent[]
  try {
    normalized = params.normalize
      ? await params.normalize()
      : [provider.normalizeEvent?.(verified) ?? null].filter((event): event is NormalizedBillingEvent => event !== null)
  } catch (error) {
    await markWebhookEvent(db, claim.id, "failed", "event could not be normalised", "PROCESSING_ERROR")
    log.error(error instanceof ConnectorFetchError ? "provider fetch failed during normalisation" : "webhook normalisation failed", {
      workspaceId,
      error,
    })
    return { status: "failed" }
  }

  if (normalized.length === 0) {
    await markWebhookEvent(db, claim.id, "ignored", `unhandled type ${verified.rawType}`, "UNSUPPORTED_EVENT")
    return { status: "ignored" }
  }

  try {
    const outcomes: EventOutcome[] = []
    for (const event of normalized) {
      if (connectionEnvironment && event.environment !== connectionEnvironment) {
        outcomes.push({ status: "ignored", reason: "event environment does not match its connection", code: "TEST_LIVE_MISMATCH" })
        continue
      }
      outcomes.push(await handleBillingEvent(workspaceId, event, new Date(), db, { integrationId }))
    }
    const summary = summarizeOutcomes(outcomes)
    await markWebhookEvent(db, claim.id, summary.status, summary.message, summary.code)

    log.info("webhook processed", {
      workspaceId,
      outcome: summary.status,
      reason: summary.code ?? null,
      normalizedEventType: normalized.map((event) => event.type).join(","),
    })
    return { status: "processed" }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error"
    const code: ReasonCode = error instanceof PaymentNotRecordedYetError ? "PAYMENT_NOT_RECORDED_YET" : "PROCESSING_ERROR"
    await markWebhookEvent(db, claim.id, "failed", message, code)
    if (error instanceof PaymentNotRecordedYetError) {
      log.warn("webhook deferred until its payment is recorded", { workspaceId })
    } else {
      log.error("webhook processing failed", { workspaceId, error })
    }
    return { status: "failed" }
  }
}

/**
 * How a claim ends when one delivery yielded several facts: processed if any
 * fact was, and the reason that matters most — a fault before an expected
 * outcome (an organic customer is not news; a dropped payment is).
 */
export function summarizeOutcomes(outcomes: EventOutcome[]): {
  status: "processed" | "ignored"
  message: string | undefined
  code: ReasonCode | undefined
} {
  const codes = outcomes.flatMap((outcome) => ("code" in outcome && outcome.code ? [outcome.code] : []))
  const code = codes.find((candidate) => !EXPECTED_REASONS.has(candidate)) ?? codes[0]
  const processed = outcomes.some((outcome) => outcome.status === "processed")
  const ignored = outcomes.find((outcome): outcome is Extract<EventOutcome, { status: "ignored" }> => outcome.status === "ignored")
  return {
    status: processed ? "processed" : "ignored",
    message: processed ? undefined : ignored?.reason,
    code,
  }
}

async function liveModeActive(workspaceId: string): Promise<boolean> {
  const entitlements = await getWorkspaceEntitlements(db, workspaceId)
  return entitlements.standing !== "restricted" && canUseFeature(entitlements, "liveMode")
}

/**
 * Turns a normalised billing event into ledger facts. Runs on the service
 * connection (the caller is Stripe, not a user) inside one transaction, so a
 * failure half-way leaves nothing behind for a retry to trip over.
 *
 * Every read and write is confined to the event's environment: a test event
 * only finds test customers and test programs, a live event only live ones.
 *
 * `client` exists for the database-backed tests, which run everything inside
 * a transaction they roll back.
 */
export async function handleBillingEvent(
  workspaceId: string,
  event: NormalizedBillingEvent,
  now = new Date(),
  client: Pick<Transaction, "transaction"> = db,
  context: EventContext = {},
): Promise<EventOutcome> {
  return client.transaction(async (tx) => {
    switch (event.type) {
      case "subscription.updated":
        return upsertSubscription(tx, workspaceId, event, context)
      case "subscription.cancelled":
        return cancelSubscription(tx, workspaceId, event)
      case "payment.succeeded":
        return recordPayment(tx, workspaceId, event, now, context)
      case "payment.referenced":
        return recordReferences(tx, workspaceId, event, now)
      case "payment.refunded":
        return recordRefund(tx, workspaceId, event, now)
      case "payment.disputeWon":
        return restoreWonDispute(tx, workspaceId, event, now)
      case "attribution.bind":
        return bindCheckoutReference(tx, workspaceId, event, now, context)
      case "payment.failed":
        // No money moved. Kept on the event row so diagnostics can show it.
        return { status: "ignored", reason: `payment failed${event.reason ? `: ${event.reason}` : ""}`, code: "PAYMENT_FAILED" }
    }
  })
}

interface ResolvedCustomer {
  id: string
  /** The founder's own id, when identify bound one — what attributions carry. */
  externalId: string | null
}

interface CustomerSignals {
  environment: BillingEnvironment
  provider: BillingProviderId
  providerCustomerId: string | null
  email: string | null
  /** The SaaS's own customer id, from server-set checkout metadata. */
  externalCustomerId?: string | null
  integrationId?: string | null
}

/**
 * Finds the customer a provider event belongs to, in the event's environment —
 * one deterministic order (UNIVERSAL_ATTRIBUTION_ARCHITECTURE.md §3):
 *
 * 1. The provider identity (`billing_identities`), any provider.
 * 2. The legacy provider id on `customers` (rows from before identities) — and
 *    the identity is written, so step 1 finds it next time.
 * 3. The SaaS's own id carried by the checkout (`externalCustomerId`): the
 *    provider-switch path — a Mercado Pago payer reaches the customer a Stripe
 *    subscription already had.
 * 4. The e-mail hash rule, unchanged: a customer that identify recorded with
 *    that e-mail and no provider id (or this same one) in this workspace.
 *    Exactly one must match; an ambiguous e-mail matches nothing. The provider
 *    id is then back-filled — onto the customer only if its column is still
 *    empty, and onto its bound attributions — so later payments without an
 *    e-mail match by id. A different provider id is never overwritten.
 *    (DOCS_TECHNICAL_FINDINGS.md T3.)
 * 5. Otherwise a new customer with no attribution.
 *
 * A reference token on the event is bound BEFORE this runs (the bridge), and
 * the bridge itself links the identity when the token's visitor was identified.
 * No step merges customers by e-mail or moves an identity silently.
 */
async function resolveCustomer(
  tx: Transaction,
  workspaceId: string,
  signals: CustomerSignals,
): Promise<ResolvedCustomer | null> {
  const { environment, provider, providerCustomerId, email } = signals
  if (!providerCustomerId) return null
  const key = { workspaceId, environment, provider, providerCustomerId }
  const link = (customerId: string, repoint = false) =>
    linkBillingIdentity(tx, key, customerId, { integrationId: signals.integrationId, repoint })
  const externalCustomerId = signals.externalCustomerId?.trim() || null

  // 1. A known identity.
  const known = await customerByIdentity(tx, key)
  if (known?.externalId || (known && !externalCustomerId)) return known

  // 3 (early, when the identity is known but anonymous): the checkout named the
  // SaaS's customer. A placeholder row the webhook created is superseded.
  if (known && externalCustomerId) {
    const named = await customerByExternalId(tx, workspaceId, environment, externalCustomerId)
    if (named) {
      await link(named.id, true)
      return named
    }
    const claimed = await claimExternalId(tx, known.id, externalCustomerId)
    return claimed ? { id: known.id, externalId: externalCustomerId } : known
  }

  // 2. The legacy provider id on `customers`.
  const [byProvider] = await tx
    .select({ id: customers.id, externalId: customers.externalId })
    .from(customers)
    .where(
      and(
        eq(customers.workspaceId, workspaceId),
        eq(customers.environment, environment),
        eq(customers.provider, provider),
        eq(customers.providerCustomerId, providerCustomerId),
      ),
    )
    .limit(1)

  if (byProvider?.externalId) {
    await link(byProvider.id)
    return byProvider
  }

  // 3. The SaaS's own id.
  if (externalCustomerId) {
    const named = await customerByExternalId(tx, workspaceId, environment, externalCustomerId)
    if (named) {
      const owner = await link(named.id, true)
      return owner === named.id ? named : ((await customerByIdentity(tx, key)) ?? named)
    }
    if (byProvider) {
      const claimed = await claimExternalId(tx, byProvider.id, externalCustomerId)
      await link(byProvider.id)
      return { id: byProvider.id, externalId: claimed ? externalCustomerId : null }
    }
    const created = await createCustomer(tx, workspaceId, signals, email ? hashEmail(email) : null, externalCustomerId)
    if (created) {
      await link(created.id)
      return created
    }
  }

  // 4. The e-mail hash rule.
  const emailHash = email ? hashEmail(email) : null
  const identified = emailHash
    ? await identifiedCustomerByEmail(tx, workspaceId, environment, provider, emailHash, providerCustomerId)
    : null

  if (identified) {
    if (!byProvider) {
      await tx
        .update(customers)
        .set({ providerCustomerId, updatedAt: new Date() })
        .where(and(eq(customers.id, identified.id), isNull(customers.providerCustomerId)))
    }

    await tx
      .update(attributions)
      .set({ providerCustomerId: attributionCustomerKey(provider, providerCustomerId), updatedAt: new Date() })
      .where(
        and(
          eq(attributions.customerExternalId, identified.externalId),
          isNull(attributions.providerCustomerId),
          inArray(
            attributions.programId,
            tx
              .select({ id: programs.id })
              .from(programs)
              .where(and(eq(programs.workspaceId, workspaceId), eq(programs.environment, environment))),
          ),
        ),
      )

    logger.info("customer matched by e-mail hash", { workspaceId, provider })
    // A row the webhook created earlier (e.g. from a subscription event with no
    // e-mail) keeps owning the ledger rows; the attribution comes from identify.
    const owner = byProvider?.id ?? identified.id
    await link(owner)
    return { id: owner, externalId: identified.externalId }
  }

  if (byProvider) {
    await link(byProvider.id)
    return byProvider
  }

  // 5. A new customer. Two events of a new customer processed at once (a
  // PaymentIntent and its invoice) both get here: the loser reads the winner's row.
  const created = await createCustomer(tx, workspaceId, signals, emailHash, null)
  if (!created) return null
  await link(created.id)
  return created
}

/**
 * Inserts the customer row for a provider id (and, when known, the SaaS's own
 * id). On a race it returns the row the winner wrote.
 */
async function createCustomer(
  tx: Transaction,
  workspaceId: string,
  signals: CustomerSignals,
  emailHash: string | null,
  externalId: string | null,
): Promise<ResolvedCustomer | null> {
  const { environment, provider, providerCustomerId } = signals
  if (!providerCustomerId) return null
  const [created] = await tx
    .insert(customers)
    .values({ workspaceId, environment, provider, providerCustomerId, emailHash, externalId })
    .onConflictDoNothing()
    .returning({ id: customers.id, externalId: customers.externalId })
  if (created) return created

  const [winner] = await tx
    .select({ id: customers.id, externalId: customers.externalId })
    .from(customers)
    .where(
      and(
        eq(customers.workspaceId, workspaceId),
        eq(customers.environment, environment),
        or(
          and(eq(customers.provider, provider), eq(customers.providerCustomerId, providerCustomerId)),
          externalId ? eq(customers.externalId, externalId) : sql`false`,
        ),
      ),
    )
    .limit(1)
  return winner ?? null
}

/**
 * Writes the SaaS's id onto a customer that has none, when no other row of the
 * same workspace and environment holds it. A concurrent writer loses on the
 * unique key, which fails the event and lets the provider's retry see the winner.
 */
async function claimExternalId(tx: Transaction, customerId: string, externalId: string): Promise<boolean> {
  const [target] = await tx
    .select({ workspaceId: customers.workspaceId, environment: customers.environment, externalId: customers.externalId })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1)
  if (!target || target.externalId) return false
  if (await customerByExternalId(tx, target.workspaceId, target.environment, externalId)) return false
  await tx.update(customers).set({ externalId, updatedAt: new Date() }).where(eq(customers.id, customerId))
  return true
}

async function identifiedCustomerByEmail(
  tx: Transaction,
  workspaceId: string,
  environment: BillingEnvironment,
  provider: BillingProviderId,
  emailHash: string,
  providerCustomerId: string,
): Promise<{ id: string; externalId: string } | null> {
  const rows = await tx
    .select({ id: customers.id, externalId: customers.externalId })
    .from(customers)
    .where(
      and(
        eq(customers.workspaceId, workspaceId),
        eq(customers.environment, environment),
        eq(customers.provider, provider),
        eq(customers.emailHash, emailHash),
        isNotNull(customers.externalId),
        or(isNull(customers.providerCustomerId), eq(customers.providerCustomerId, providerCustomerId)),
      ),
    )
    .limit(2)

  if (rows.length !== 1) return null
  const [row] = rows
  return row?.externalId ? { id: row.id, externalId: row.externalId } : null
}

// ---------------------------------------------------------------------------
// One payment, one commission.
//
// Stripe reports one subscription payment up to three ways, in any order and
// possibly at the same time: `invoice.paid` (recorded under `in_…`),
// `payment_intent.succeeded` (`pi_…`, with its charge `ch_…`) and
// `invoice_payment.paid`, the only event that links the two. From API basil
// on (the installed SDK is dahlia) neither the PaymentIntent nor its charge
// names its invoice, so the PaymentIntent event cannot tell by itself whether
// it is a one-off payment or an invoice's.
//
// The rule:
//   - `transaction_references` maps every id of a payment to the one id it is
//     recorded under. Every recorded payment maps its own id too.
//   - Every event that touches a payment first takes a transaction-scoped
//     advisory lock on each id it knows (sorted, so never a deadlock). The
//     PaymentIntent event and the link share `pi_`/`ch_`; the invoice event and
//     the link share `in_`. So the link is serialised against both.
//   - A payment event whose ids already point at a recorded payment records
//     nothing. One whose ids point at a payment not recorded yet (the link came
//     first: `pi_ → in_`) records nothing either: it belongs to that invoice,
//     whose own event records it.
//   - The link, holding the locks, looks at what is recorded under any of its
//     ids. None: it maps the ids to the invoice. One: it maps every id to that
//     payment, whichever event recorded it, so the event still to come finds
//     it. Two — the PaymentIntent and the invoice events both ran before the
//     link, which no lock can prevent since they share no id — the payment
//     recorded first (a commissioned one first) is kept and the second is
//     reversed in full by an `adjustment` transaction (`dup_<id>`) and a
//     reversal row. Nothing is deleted (CLAUDE.md rule 9); the net is one
//     commission, and redeliveries of any of the three events change nothing.
// ---------------------------------------------------------------------------

/** Prefix of the target of references for a payment deliberately not recorded (no customer). */
const UNRECORDED = "unrecorded:"

async function lockPaymentIds(tx: Transaction, workspaceId: string, provider: BillingProviderId, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`payment:${workspaceId}:${provider}:${id}`}, 0))`)
  }
}

/** Remembers every id of a payment, pointing at the id it is recorded under. Existing links are kept. */
async function saveReferences(
  tx: Transaction,
  workspaceId: string,
  provider: BillingProviderId,
  providerTransactionId: string,
  references: string[],
): Promise<void> {
  const ids = [...new Set([providerTransactionId, ...references])]
  await tx
    .insert(transactionReferences)
    .values(ids.map((referenceId) => ({ workspaceId, provider, referenceId, providerTransactionId })))
    .onConflictDoNothing({
      target: [transactionReferences.workspaceId, transactionReferences.provider, transactionReferences.referenceId],
    })
}

/** Points every one of `ids` at `providerTransactionId`, replacing earlier links. */
async function repointReferences(
  tx: Transaction,
  workspaceId: string,
  provider: BillingProviderId,
  providerTransactionId: string,
  ids: string[],
): Promise<void> {
  await tx
    .insert(transactionReferences)
    .values([...new Set(ids)].map((referenceId) => ({ workspaceId, provider, referenceId, providerTransactionId })))
    .onConflictDoUpdate({
      target: [transactionReferences.workspaceId, transactionReferences.provider, transactionReferences.referenceId],
      set: { providerTransactionId },
    })
}

/** The ids `ids` are linked to in `transaction_references`, whether or not a payment is recorded under them. */
async function linkedTargets(
  tx: Transaction,
  workspaceId: string,
  provider: BillingProviderId,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return []
  const rows = await tx
    .selectDistinct({ id: transactionReferences.providerTransactionId })
    .from(transactionReferences)
    .where(
      and(
        eq(transactionReferences.workspaceId, workspaceId),
        eq(transactionReferences.provider, provider),
        inArray(transactionReferences.referenceId, ids),
      ),
    )
  return rows.map((row) => row.id)
}

/**
 * The recorded payments any of `references` names: through
 * `transaction_references` first, and directly by id only for a payment that
 * has no reference row of its own (recorded before references existed). A
 * payment reversed as a duplicate has had its ids re-pointed, so it is never
 * found again.
 */
async function findPayments(
  tx: Transaction,
  workspaceId: string,
  provider: BillingProviderId,
  references: string[],
) {
  if (references.length === 0) return []

  const linked = tx
    .select({ id: transactionReferences.providerTransactionId })
    .from(transactionReferences)
    .where(
      and(
        eq(transactionReferences.workspaceId, workspaceId),
        eq(transactionReferences.provider, provider),
        inArray(transactionReferences.referenceId, references),
      ),
    )

  const ownReference = tx
    .select({ id: transactionReferences.id })
    .from(transactionReferences)
    .where(
      and(
        eq(transactionReferences.workspaceId, workspaceId),
        eq(transactionReferences.provider, provider),
        eq(transactionReferences.referenceId, qualified(transactions.providerTransactionId)),
      ),
    )

  return tx
    .select({
      id: transactions.id,
      customerId: transactions.customerId,
      subscriptionId: transactions.subscriptionId,
      currency: transactions.currency,
      grossAmountMinor: transactions.grossAmountMinor,
      providerTransactionId: transactions.providerTransactionId,
      createdAt: transactions.createdAt,
      commissioned: sql<boolean>`exists (
        select 1 from ${commissions}
         where ${commissions.transactionId} = ${qualified(transactions.id)}
           and ${commissions.reversalOfCommissionId} is null)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.workspaceId, workspaceId),
        eq(transactions.provider, provider),
        eq(transactions.type, "payment"),
        or(
          inArray(transactions.providerTransactionId, linked),
          and(inArray(transactions.providerTransactionId, references), notExists(ownReference)),
        ),
      ),
    )
    .orderBy(transactions.createdAt, transactions.id)
}

async function findPaymentByReferences(
  tx: Transaction,
  workspaceId: string,
  provider: BillingProviderId,
  references: string[],
) {
  const [first] = await findPayments(tx, workspaceId, provider, references)
  return first ?? null
}

async function findSubscriptionId(tx: Transaction, workspaceId: string, providerSubscriptionId: string | null) {
  if (!providerSubscriptionId) return null
  const [subscription] = await tx
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(eq(subscriptions.workspaceId, workspaceId), eq(subscriptions.providerSubscriptionId, providerSubscriptionId)),
    )
    .limit(1)
  return subscription?.id ?? null
}

async function upsertSubscription(
  tx: Transaction,
  workspaceId: string,
  event: Extract<NormalizedBillingEvent, { type: "subscription.updated" }>,
  context: EventContext,
): Promise<EventOutcome> {
  const sub = event.subscription
  // Strategy D: the founder put the reference on the subscription itself.
  await bindTokenIfPresent(tx, workspaceId, event.environment, event.provider, event.attributionToken, sub.providerCustomerId, context)

  const customer = await resolveCustomer(tx, workspaceId, {
    environment: event.environment,
    provider: event.provider,
    providerCustomerId: sub.providerCustomerId || null,
    email: event.customerEmail,
    externalCustomerId: event.externalCustomerId,
    integrationId: context.integrationId,
  })
  const customerId = customer?.id

  if (!customerId) return { status: "ignored", reason: "subscription has no customer", code: "CUSTOMER_NOT_LINKED" }

  await tx
    .insert(subscriptions)
    .values({
      workspaceId,
      customerId,
      provider: event.provider,
      providerSubscriptionId: sub.providerSubscriptionId,
      status: sub.status,
      currency: sub.currency,
      amountMinor: sub.amountMinor,
      interval: sub.interval,
      startedAt: sub.startedAt,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelledAt: sub.cancelledAt,
    })
    .onConflictDoUpdate({
      target: [subscriptions.provider, subscriptions.providerSubscriptionId],
      set: {
        status: sub.status,
        currency: sub.currency,
        amountMinor: sub.amountMinor,
        currentPeriodStart: sub.currentPeriodStart,
        currentPeriodEnd: sub.currentPeriodEnd,
        cancelledAt: sub.cancelledAt,
        updatedAt: new Date(),
      },
    })

  return { status: "processed", detail: `subscription ${sub.status}` }
}

async function cancelSubscription(
  tx: Transaction,
  workspaceId: string,
  event: Extract<NormalizedBillingEvent, { type: "subscription.cancelled" }>,
): Promise<EventOutcome> {
  await tx
    .update(subscriptions)
    .set({ status: "cancelled", cancelledAt: event.cancelledAt, updatedAt: new Date() })
    .where(
      and(
        eq(subscriptions.workspaceId, workspaceId),
        eq(subscriptions.providerSubscriptionId, event.providerSubscriptionId),
      ),
    )

  return { status: "processed", detail: "subscription cancelled" }
}

/**
 * Resolves the affiliate to credit for a customer, among programs of the
 * event's environment. Renewal lock: an attribution that already earned a
 * commission for this customer wins over any other bound to them (a second
 * visitor id identified later, say), so renewals keep paying the affiliate
 * who converted the customer. Otherwise the most recent attribution.
 */

/**
 * Binds a reference a money event carried in its own payload, when it carried
 * one. Never fails the event: a reference that does not resolve leaves the
 * payment exactly where it would have been without this rework — recorded,
 * possibly unattributed — and the outcome is logged for diagnostics rather than
 * thrown (INTEGRATION_ARCHITECTURE_V2.md §9).
 */
async function bindTokenIfPresent(
  tx: Transaction,
  workspaceId: string,
  environment: BillingEnvironment,
  provider: BillingProviderId,
  token: string | null | undefined,
  providerCustomerId: string | null,
  context: EventContext = {},
): Promise<BindOutcome | null> {
  if (!token || !providerCustomerId) return null
  const outcome = await bindAttributionToken(tx, {
    workspaceId,
    environment,
    provider,
    token,
    providerCustomerId,
    integrationId: context.integrationId,
  })
  if (outcome.status !== "bound" && outcome.status !== "already_bound") {
    logger.info("attribution reference on a payment did not resolve", { workspaceId, status: outcome.status })
  }
  return outcome
}

/**
 * A checkout said who its customer is and carried our reference — Stripe's
 * `checkout.session.completed`, which covers hosted Checkout and Payment Links
 * (INTEGRATION_ARCHITECTURE_V2.md §4).
 *
 * This is the event that makes `POST /api/identify` optional: it binds the
 * visitor's attribution to the Stripe customer without the founder writing a
 * line of backend code. It moves no money and creates no transaction, so it
 * cannot duplicate a payment — the invoice or PaymentIntent event still records
 * it, exactly as before.
 *
 * Because Stripe orders nothing, the payment may already be in the ledger with
 * no commission. `commissionsForBoundCustomer` closes that case.
 */
async function bindCheckoutReference(
  tx: Transaction,
  workspaceId: string,
  event: Extract<NormalizedBillingEvent, { type: "attribution.bind" }>,
  now: Date,
  context: EventContext,
): Promise<EventOutcome> {
  let bound: BindOutcome | null = null
  if (event.attributionToken) {
    bound = await bindAttributionToken(tx, {
      workspaceId,
      environment: event.environment,
      provider: event.provider,
      token: event.attributionToken,
      providerCustomerId: event.providerCustomerId,
      integrationId: context.integrationId,
    })
  }

  // The checkout named the SaaS's own customer (server-set metadata): the
  // provider customer is that customer, whatever the token said.
  const customer = event.externalCustomerId
    ? await resolveCustomer(tx, workspaceId, {
        environment: event.environment,
        provider: event.provider,
        providerCustomerId: event.providerCustomerId,
        email: null,
        externalCustomerId: event.externalCustomerId,
        integrationId: context.integrationId,
      })
    : null

  const resolved =
    customer ??
    (bound && (bound.status === "bound" || bound.status === "already_bound")
      ? { id: bound.customerId, externalId: null }
      : null)

  if (!resolved) {
    const status = bound?.status ?? "token_unknown"
    return { status: "ignored", reason: `attribution reference ${status}`, code: bindReason(status) }
  }

  const created = await commissionsForBoundCustomer(
    tx,
    workspaceId,
    {
      customerId: resolved.id,
      environment: event.environment,
      provider: event.provider,
      providerCustomerId: event.providerCustomerId,
      customerExternalId: resolved.externalId,
    },
    now,
  )

  return {
    status: "processed",
    detail: `attribution ${bound?.status ?? "customer linked"}${created > 0 ? `, ${created} commission(s) backfilled` : ""}`,
  }
}

function bindReason(status: BindOutcome["status"]): ReasonCode | undefined {
  switch (status) {
    case "token_unknown":
      return "TOKEN_UNKNOWN"
    case "token_expired":
      return "TOKEN_EXPIRED"
    case "token_conflict":
      return "TOKEN_CONFLICT"
    default:
      return undefined
  }
}

async function recordPayment(
  tx: Transaction,
  workspaceId: string,
  event: Extract<NormalizedBillingEvent, { type: "payment.succeeded" }>,
  now: Date,
  context: EventContext = {},
): Promise<EventOutcome> {
  const ids = [event.providerTransactionId, ...event.providerReferences]
  await lockPaymentIds(tx, workspaceId, event.provider, ids)

  // The same money already recorded under another of its ids. Remember the
  // ids; record nothing. An invoice arriving after its PaymentIntent was
  // recorded lends it the subscription it belongs to.
  const recordedAs = await findPaymentByReferences(tx, workspaceId, event.provider, ids)
  if (recordedAs && recordedAs.providerTransactionId !== event.providerTransactionId) {
    await saveReferences(tx, workspaceId, event.provider, recordedAs.providerTransactionId, ids)
    const subscriptionId = await findSubscriptionId(tx, workspaceId, event.providerSubscriptionId)
    if (subscriptionId && !recordedAs.subscriptionId) {
      await tx.update(transactions).set({ subscriptionId }).where(eq(transactions.id, recordedAs.id))
    }
    return { status: "processed", detail: `payment already recorded as ${recordedAs.providerTransactionId}` }
  }

  if (!recordedAs) {
    // Linked to a payment that is not recorded (yet): a PaymentIntent whose
    // invoice's own event will record it.
    const owner = (await linkedTargets(tx, workspaceId, event.provider, ids)).find(
      (target) => target !== event.providerTransactionId,
    )
    if (owner) {
      return { status: "processed", detail: `payment belongs to ${owner.replace(UNRECORDED, "")}; recorded with it` }
    }
  }

  // Guest checkout (Flow B): the provider named no customer, but the payment
  // carried a reference or the SaaS's id. The payment itself becomes the
  // identity, so the reference can still be honoured. Without either, the
  // payment stays out of the ledger exactly as before.
  const providerCustomerId =
    event.providerCustomerId ??
    (event.attributionToken || event.externalCustomerId ? guestCustomerId(event.providerTransactionId) : null)

  // Strategies C and D: a custom checkout carried the reference in metadata on
  // the PaymentIntent, the subscription or the invoice. Binding before the
  // customer is resolved means `findAttribution` below sees the attribution
  // this very payment created the link for — no second event, no backfill.
  await bindTokenIfPresent(tx, workspaceId, event.environment, event.provider, event.attributionToken, providerCustomerId, context)

  const customer = await resolveCustomer(tx, workspaceId, {
    environment: event.environment,
    provider: event.provider,
    providerCustomerId,
    email: event.customerEmail,
    externalCustomerId: event.externalCustomerId,
    integrationId: context.integrationId,
  })

  if (!customer) {
    // Nothing to attach it to, so it is not in the ledger. Its ids are kept so a
    // later refund of it is recognised and ignored instead of waiting forever.
    await tx
      .insert(transactionReferences)
      .values(
        [...new Set(ids)].map((referenceId) => ({
          workspaceId,
          provider: event.provider,
          referenceId,
          providerTransactionId: `${UNRECORDED}${event.providerTransactionId}`,
        })),
      )
      .onConflictDoNothing()
    return { status: "ignored", reason: PAYMENT_WITHOUT_CUSTOMER, code: "CUSTOMER_NOT_LINKED" }
  }
  const customerId = customer.id

  // Second idempotency barrier: unique on (workspace, provider, provider id).
  const [transaction] = await tx
    .insert(transactions)
    .values({
      workspaceId,
      customerId,
      subscriptionId: await findSubscriptionId(tx, workspaceId, event.providerSubscriptionId),
      provider: event.provider,
      providerTransactionId: event.providerTransactionId,
      type: "payment",
      status: "succeeded",
      environment: event.environment,
      integrationId: context.integrationId ?? null,
      currency: event.currency,
      grossAmountMinor: event.amountMinor,
      occurredAt: event.occurredAt,
    })
    .onConflictDoNothing({
      target: [transactions.workspaceId, transactions.provider, transactions.providerTransactionId],
    })
    .returning({ id: transactions.id })

  await saveReferences(tx, workspaceId, event.provider, event.providerTransactionId, event.providerReferences)

  if (!transaction) {
    return { status: "processed", detail: "transaction already recorded" }
  }

  const commission = await commissionForTransaction(
    tx,
    workspaceId,
    {
      transactionId: transaction.id,
      customerId,
      environment: event.environment,
      provider: event.provider,
      providerCustomerId,
      customerExternalId: customer.externalId,
      currency: event.currency,
      grossAmountMinor: event.amountMinor,
      occurredAt: event.occurredAt,
      eventId: event.providerEventId,
    },
    now,
  )
  return { status: "processed", commissionId: commission.commissionId, detail: commission.detail, code: commission.code }
}


/**
 * `invoice_payment.paid`: links an invoice to the PaymentIntent and charge that
 * paid it, and reconciles a payment already recorded twice (see "One payment,
 * one commission" above).
 */
async function recordReferences(
  tx: Transaction,
  workspaceId: string,
  event: Extract<NormalizedBillingEvent, { type: "payment.referenced" }>,
  now: Date,
): Promise<EventOutcome> {
  const ids = [event.providerTransactionId, ...event.providerReferences]
  await lockPaymentIds(tx, workspaceId, event.provider, ids)

  const recorded = await findPayments(tx, workspaceId, event.provider, ids)
  if (recorded.length === 0) {
    await saveReferences(tx, workspaceId, event.provider, event.providerTransactionId, event.providerReferences)
    return { status: "processed", detail: "payment references linked" }
  }

  const keep = recorded.find((payment) => payment.commissioned) ?? recorded[0]!
  const duplicates = recorded.filter((payment) => payment.id !== keep.id)

  await repointReferences(tx, workspaceId, event.provider, keep.providerTransactionId, [
    ...ids,
    ...recorded.map((payment) => payment.providerTransactionId),
  ])

  for (const duplicate of duplicates) {
    await reverseDuplicatePayment(tx, workspaceId, event, duplicate, keep.providerTransactionId, now)
  }

  return {
    status: "processed",
    detail:
      duplicates.length > 0
        ? `payment references linked; ${duplicates.length} duplicate record(s) of ${keep.providerTransactionId} reversed`
        : `payment references linked to ${keep.providerTransactionId}`,
  }
}

/**
 * The second record of a payment already recorded under another id: an
 * `adjustment` transaction undoes its amount and a reversal row undoes its
 * commission in full. Idempotent through the adjustment's own id.
 */
async function reverseDuplicatePayment(
  tx: Transaction,
  workspaceId: string,
  event: Extract<NormalizedBillingEvent, { type: "payment.referenced" }>,
  duplicate: Awaited<ReturnType<typeof findPayments>>[number],
  keptProviderTransactionId: string,
  now: Date,
): Promise<void> {
  const [adjustment] = await tx
    .insert(transactions)
    .values({
      workspaceId,
      customerId: duplicate.customerId,
      subscriptionId: duplicate.subscriptionId,
      provider: event.provider,
      providerTransactionId: `dup_${duplicate.providerTransactionId}`,
      providerParentTransactionId: duplicate.providerTransactionId,
      type: "adjustment",
      status: "succeeded",
      environment: event.environment,
      currency: duplicate.currency,
      grossAmountMinor: -Math.abs(duplicate.grossAmountMinor),
      occurredAt: event.occurredAt,
    })
    .onConflictDoNothing({
      target: [transactions.workspaceId, transactions.provider, transactions.providerTransactionId],
    })
    .returning({ id: transactions.id })

  if (!adjustment) return

  const [original] = await tx
    .select({
      id: commissions.id,
      programId: commissions.programId,
      programAffiliateId: commissions.programAffiliateId,
      customerId: commissions.customerId,
      currency: commissions.currency,
      baseAmountMinor: commissions.baseAmountMinor,
      commissionAmountMinor: commissions.commissionAmountMinor,
      status: commissions.status,
    })
    .from(commissions)
    .where(and(eq(commissions.transactionId, duplicate.id), isNull(commissions.reversalOfCommissionId)))
    .limit(1)
    .for("update")

  logger.warn("payment recorded under two ids; the later record is reversed", {
    workspaceId,
    provider: event.provider,
    eventId: event.providerEventId,
  })

  if (!original) return

  const [reversedBefore] = await tx
    .select({ minor: sql<number>`coalesce(sum(abs(${commissions.commissionAmountMinor})), 0)::bigint`.mapWith(Number) })
    .from(commissions)
    .where(eq(commissions.reversalOfCommissionId, original.id))

  const remaining = Math.abs(original.commissionAmountMinor) - (reversedBefore?.minor ?? 0)
  if (remaining <= 0) return

  const plan = planReversal(original.status, true)
  const [reversal] = await tx
    .insert(commissions)
    .values({
      workspaceId,
      programId: original.programId,
      programAffiliateId: original.programAffiliateId,
      customerId: original.customerId,
      transactionId: adjustment.id,
      currency: original.currency,
      baseAmountMinor: -Math.abs(original.baseAmountMinor),
      commissionRate: null,
      commissionAmountMinor: -remaining,
      status: plan.rowStatus,
      eligibleAt: now,
      reversalOfCommissionId: original.id,
      ruleApplied: `duplicate record of payment ${keptProviderTransactionId}`,
      reversedAt: now,
    })
    .returning({ id: commissions.id })

  await applyReversalPlan(tx, original.id, reversal?.id ?? null, plan, now)

  if (original.status === "paid") {
    logger.warn("duplicate commission was already paid; reversal recorded without clawback", {
      workspaceId,
      provider: event.provider,
      eventId: event.providerEventId,
    })
  }
}

async function applyReversalPlan(
  tx: Transaction,
  originalId: string,
  reversalId: string | null,
  plan: ReturnType<typeof planReversal>,
  now: Date,
) {
  // The original row survives; at most its status changes. History is preserved.
  if (plan.flipOriginal) {
    await tx
      .update(commissions)
      .set({ status: "reversed", reversedAt: now, updatedAt: now })
      .where(eq(commissions.id, originalId))
  }

  // Earlier partial rows were payable to net against the original; with the
  // original reversed they would subtract from nothing.
  if (plan.settlePriorReversals && reversalId) {
    await tx
      .update(commissions)
      .set({ status: "reversed", updatedAt: now })
      .where(
        and(
          eq(commissions.reversalOfCommissionId, originalId),
          inArray(commissions.status, ["pending", "available"]),
          ne(commissions.id, reversalId),
        ),
      )
  }
}

/**
 * Refunds and disputes never delete. Each one — a partial refund included — is
 * its own transaction under the refund or dispute id, found through any id of
 * the payment it undoes, and inserts a negative reversal row proportional to
 * its amount. The original flips to `reversed` only once refunds cover the
 * whole payment, and never when it is already `paid` (CLAUDE.md rule 9; the
 * statuses are decided by `planReversal`).
 *
 * A refund of a payment not recorded yet throws `PaymentNotRecordedYetError`,
 * so the provider retries it; one of a payment deliberately left out of the
 * ledger (it had no customer) is ignored.
 */
async function recordRefund(
  tx: Transaction,
  workspaceId: string,
  event: Extract<NormalizedBillingEvent, { type: "payment.refunded" }>,
  now: Date,
): Promise<EventOutcome> {
  await lockPaymentIds(tx, workspaceId, event.provider, event.paymentReferences)
  const original = await findPaymentByReferences(tx, workspaceId, event.provider, event.paymentReferences)

  if (!original) {
    const targets = await linkedTargets(tx, workspaceId, event.provider, event.paymentReferences)
    if (targets.length > 0 && targets.every((target) => target.startsWith(UNRECORDED))) {
      return { status: "ignored", reason: "refund of a payment recorded without a customer" }
    }
    throw new PaymentNotRecordedYetError(event.providerTransactionId)
  }

  const type = event.isChargeback ? "chargeback" : "refund"
  let refundedMinor = Math.abs(event.amountMinor)
  let providerTransactionId = event.providerTransactionId

  // A provider that reports the running refunded total (Mercado Pago, Asaas,
  // AbacatePay): record only what is not recorded yet, under an id derived
  // from the total — so every redelivery, and every later notification of the
  // same state, is the same row. Serialised by the payment locks above.
  if (event.cumulativeRefundedMinor !== undefined && !event.isChargeback) {
    const [recorded] = await tx
      .select({ minor: sql<number>`coalesce(sum(-${transactions.grossAmountMinor}), 0)::bigint`.mapWith(Number) })
      .from(transactions)
      .where(
        and(
          eq(transactions.workspaceId, workspaceId),
          eq(transactions.provider, event.provider),
          eq(transactions.providerParentTransactionId, original.providerTransactionId),
          eq(transactions.type, "refund"),
        ),
      )
    const delta = Math.abs(event.cumulativeRefundedMinor) - (recorded?.minor ?? 0)
    if (delta <= 0) return { status: "processed", detail: "refund already recorded" }
    refundedMinor = delta
    providerTransactionId = `${original.providerTransactionId}:refund:${Math.abs(event.cumulativeRefundedMinor)}`
  }

  const [refundTransaction] = await tx
    .insert(transactions)
    .values({
      workspaceId,
      customerId: original.customerId,
      subscriptionId: original.subscriptionId,
      provider: event.provider,
      providerTransactionId,
      providerParentTransactionId: original.providerTransactionId,
      type,
      status: "succeeded",
      environment: event.environment,
      currency: event.currency,
      grossAmountMinor: -refundedMinor,
      occurredAt: event.occurredAt,
    })
    .onConflictDoNothing({
      target: [transactions.workspaceId, transactions.provider, transactions.providerTransactionId],
    })
    .returning({ id: transactions.id })

  if (!refundTransaction) {
    return { status: "processed", detail: "refund already recorded" }
  }

  // Locked, so two refunds of the same payment arriving together compute their
  // cumulative share one after the other rather than from the same snapshot.
  const [originalCommission] = await tx
    .select({
      id: commissions.id,
      programId: commissions.programId,
      programAffiliateId: commissions.programAffiliateId,
      customerId: commissions.customerId,
      currency: commissions.currency,
      baseAmountMinor: commissions.baseAmountMinor,
      commissionAmountMinor: commissions.commissionAmountMinor,
      status: commissions.status,
      eligibleAt: commissions.eligibleAt,
    })
    .from(commissions)
    .where(and(eq(commissions.transactionId, original.id), isNull(commissions.reversalOfCommissionId)))
    .limit(1)
    .for("update")

  if (!originalCommission) {
    return { status: "processed", detail: "refund recorded; no commission to reverse" }
  }

  // Refunded so far, net of won disputes: their `won_` adjustment is positive
  // and gives the disputed amount back.
  const [refundedBefore] = await tx
    .select({ minor: sql<number>`coalesce(sum(-${transactions.grossAmountMinor}), 0)::bigint`.mapWith(Number) })
    .from(transactions)
    .where(
      and(
        eq(transactions.workspaceId, workspaceId),
        eq(transactions.provider, event.provider),
        eq(transactions.providerParentTransactionId, original.providerTransactionId),
        or(
          inArray(transactions.type, ["refund", "chargeback"]),
          and(eq(transactions.type, "adjustment"), sql`left(${transactions.providerTransactionId}, 4) = ${WON_DISPUTE}`),
        ),
        ne(transactions.id, refundTransaction.id),
      ),
    )

  const [reversedBefore] = await tx
    .select({ minor: sql<number>`coalesce(sum(abs(${commissions.commissionAmountMinor})), 0)::bigint`.mapWith(Number) })
    .from(commissions)
    .where(eq(commissions.reversalOfCommissionId, originalCommission.id))
  const restoredBefore = await restoredCommissionMinor(tx, workspaceId, event.provider, original.providerTransactionId)

  const [program] = await tx.select().from(programs).where(eq(programs.id, originalCommission.programId)).limit(1)

  const [participation] = await tx
    .select({
      id: programAffiliates.id,
      programId: programAffiliates.programId,
      affiliateId: programAffiliates.affiliateId,
      status: programAffiliates.status,
      customCommissionType: programAffiliates.customCommissionType,
      customCommissionValue: programAffiliates.customCommissionValue,
    })
    .from(programAffiliates)
    .where(eq(programAffiliates.id, originalCommission.programAffiliateId))
    .limit(1)

  if (!program || !participation) {
    return { status: "processed", detail: "refund recorded; program missing" }
  }

  const result = calculateCommission({
    program: toProgramRules(program),
    participation: toParticipationRules(participation),
    transaction: {
      id: refundTransaction.id,
      type,
      currency: event.currency,
      grossAmountMinor: -refundedMinor,
      occurredAt: event.occurredAt,
    },
    attribution: {
      id: "n/a",
      programAffiliateId: participation.id,
      attributedAt: event.occurredAt,
      expiresAt: new Date(8.64e15),
      firstCommissionedAt: null,
    },
    originalCommission: {
      id: originalCommission.id,
      commissionAmountMinor: originalCommission.commissionAmountMinor,
      baseAmountMinor: originalCommission.baseAmountMinor,
      currency: originalCommission.currency,
      refundedBeforeMinor: refundedBefore?.minor ?? 0,
      reversedBeforeMinor: (reversedBefore?.minor ?? 0) - restoredBefore,
    },
    now,
  })

  if (result.kind === "skipped") {
    return { status: "processed", detail: `refund recorded: ${result.reason}` }
  }

  const plan = planReversal(
    originalCommission.status,
    isFullyRefunded(originalCommission.baseAmountMinor, (refundedBefore?.minor ?? 0) + refundedMinor),
  )

  const [reversal] = await tx
    .insert(commissions)
    .values({
      workspaceId,
      programId: program.id,
      programAffiliateId: participation.id,
      customerId: originalCommission.customerId,
      transactionId: refundTransaction.id,
      currency: result.currency,
      baseAmountMinor: result.baseAmountMinor,
      commissionRate: result.commissionRate,
      commissionAmountMinor: result.commissionAmountMinor,
      status: plan.rowStatus,
      eligibleAt: plan.rowEligibleAt === "original" ? originalCommission.eligibleAt : result.eligibleAt,
      reversalOfCommissionId: originalCommission.id,
      ruleApplied: result.ruleApplied,
      reversedAt: now,
    })
    .returning({ id: commissions.id })

  await applyReversalPlan(tx, originalCommission.id, reversal?.id ?? null, plan, now)

  if (originalCommission.status === "paid") {
    logger.warn("refund on a paid commission recorded without clawback", {
      workspaceId,
      provider: event.provider,
      eventId: event.providerEventId,
    })
  }

  return {
    status: "processed",
    commissionId: reversal?.id,
    detail: `reversed ${-result.commissionAmountMinor} ${result.currency}${plan.flipOriginal ? " (full)" : ""}`,
  }
}

/** Prefix of the adjustment that gives a won dispute's money back: `won_<dispute id>`. */
const WON_DISPUTE = "won_"

/** Commission given back by won disputes of the payment recorded as `providerTransactionId`. */
async function restoredCommissionMinor(
  tx: Transaction,
  workspaceId: string,
  provider: BillingProviderId,
  providerTransactionId: string,
): Promise<number> {
  const [row] = await tx
    .select({ minor: sql<number>`coalesce(sum(${commissions.commissionAmountMinor}), 0)::bigint`.mapWith(Number) })
    .from(commissions)
    .innerJoin(transactions, eq(transactions.id, commissions.transactionId))
    .where(
      and(
        eq(transactions.workspaceId, workspaceId),
        eq(transactions.provider, provider),
        eq(transactions.type, "adjustment"),
        eq(transactions.providerParentTransactionId, providerTransactionId),
        sql`left(${transactions.providerTransactionId}, 4) = ${WON_DISPUTE}`,
      ),
    )
  return row?.minor ?? 0
}

/**
 * A dispute closed in the merchant's favour. The chargeback stays in the ledger
 * as it happened (CLAUDE.md rule 9); a positive `won_<dispute>` adjustment gives
 * the money back and, when the chargeback actually took something from the
 * affiliate (`shouldRestoreChargeback`), a new commission row gives back the
 * reversed amount — `pending` again under the program's hold, as if just earned.
 * Idempotent through the adjustment's own id.
 *
 * A dispute whose chargeback is not recorded yet throws
 * `PaymentNotRecordedYetError`, so Stripe retries once `charge.dispute.created`
 * has gone through; one of a payment left out of the ledger is ignored.
 */
async function restoreWonDispute(
  tx: Transaction,
  workspaceId: string,
  event: Extract<NormalizedBillingEvent, { type: "payment.disputeWon" }>,
  now: Date,
): Promise<EventOutcome> {
  await lockPaymentIds(tx, workspaceId, event.provider, event.paymentReferences)
  const original = await findPaymentByReferences(tx, workspaceId, event.provider, event.paymentReferences)

  if (!original) {
    const targets = await linkedTargets(tx, workspaceId, event.provider, event.paymentReferences)
    if (targets.length > 0 && targets.every((target) => target.startsWith(UNRECORDED))) {
      return { status: "ignored", reason: "won dispute of a payment recorded without a customer" }
    }
    throw new PaymentNotRecordedYetError(event.providerDisputeId)
  }

  const [chargeback] = await tx
    .select({ id: transactions.id, grossAmountMinor: transactions.grossAmountMinor, currency: transactions.currency })
    .from(transactions)
    .where(
      and(
        eq(transactions.workspaceId, workspaceId),
        eq(transactions.provider, event.provider),
        eq(transactions.providerTransactionId, event.providerDisputeId),
        eq(transactions.type, "chargeback"),
      ),
    )
    .limit(1)

  if (!chargeback) throw new PaymentNotRecordedYetError(event.providerDisputeId)

  const [adjustment] = await tx
    .insert(transactions)
    .values({
      workspaceId,
      customerId: original.customerId,
      subscriptionId: original.subscriptionId,
      provider: event.provider,
      providerTransactionId: `${WON_DISPUTE}${event.providerDisputeId}`,
      providerParentTransactionId: original.providerTransactionId,
      type: "adjustment",
      status: "succeeded",
      environment: event.environment,
      currency: chargeback.currency,
      grossAmountMinor: Math.abs(chargeback.grossAmountMinor),
      occurredAt: event.occurredAt,
    })
    .onConflictDoNothing({
      target: [transactions.workspaceId, transactions.provider, transactions.providerTransactionId],
    })
    .returning({ id: transactions.id })

  if (!adjustment) return { status: "processed", detail: "won dispute already recorded" }

  const [reversal] = await tx
    .select({
      programId: commissions.programId,
      programAffiliateId: commissions.programAffiliateId,
      customerId: commissions.customerId,
      currency: commissions.currency,
      baseAmountMinor: commissions.baseAmountMinor,
      commissionRate: commissions.commissionRate,
      commissionAmountMinor: commissions.commissionAmountMinor,
      status: commissions.status,
      reversedAt: commissions.reversedAt,
      reversalOfCommissionId: commissions.reversalOfCommissionId,
    })
    .from(commissions)
    .where(and(eq(commissions.transactionId, chargeback.id), isNotNull(commissions.reversalOfCommissionId)))
    .limit(1)

  if (!reversal?.reversalOfCommissionId) {
    return { status: "processed", detail: "won dispute recorded; no commission to restore" }
  }

  const [originalCommission] = await tx
    .select({ id: commissions.id, status: commissions.status, reversedAt: commissions.reversedAt })
    .from(commissions)
    .where(eq(commissions.id, reversal.reversalOfCommissionId))
    .limit(1)
    .for("update")

  const restore =
    originalCommission &&
    shouldRestoreChargeback({
      reversalStatus: reversal.status,
      reversalReversedAt: reversal.reversedAt ?? now,
      originalStatus: originalCommission.status,
      originalReversedAt: originalCommission.reversedAt,
    })

  if (!restore) {
    return { status: "processed", detail: "won dispute recorded; the chargeback took nothing to restore" }
  }

  const [program] = await tx
    .select({ commissionHoldDays: programs.commissionHoldDays })
    .from(programs)
    .where(eq(programs.id, reversal.programId))
    .limit(1)
  const eligibleAt = new Date(now.getTime() + (program?.commissionHoldDays ?? 0) * 24 * 60 * 60 * 1000)

  const [restored] = await tx
    .insert(commissions)
    .values({
      workspaceId,
      programId: reversal.programId,
      programAffiliateId: reversal.programAffiliateId,
      customerId: reversal.customerId,
      transactionId: adjustment.id,
      currency: reversal.currency,
      baseAmountMinor: Math.abs(reversal.baseAmountMinor),
      commissionRate: reversal.commissionRate,
      commissionAmountMinor: Math.abs(reversal.commissionAmountMinor),
      status: "pending",
      eligibleAt,
      ruleApplied: `dispute ${event.providerDisputeId} won; restores its chargeback reversal`,
    })
    .returning({ id: commissions.id })

  return {
    status: "processed",
    commissionId: restored?.id,
    detail: `restored ${Math.abs(reversal.commissionAmountMinor)} ${reversal.currency} after a won dispute`,
  }
}
