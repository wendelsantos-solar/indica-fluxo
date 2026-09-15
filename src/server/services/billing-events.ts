import "server-only"

import { and, desc, eq, inArray, isNotNull, isNull, ne, notExists, or, sql } from "drizzle-orm"

import { hashEmail, hashPayload } from "@/lib/crypto/hash"
import { logger } from "@/lib/logger"
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
import { calculateCommission, isFullyRefunded, planReversal } from "@/server/domain/commission"
import { toProgramRules } from "@/server/repositories/programs"
import { toParticipationRules } from "@/server/repositories/affiliates"
import { claimWebhookEvent, markWebhookEvent } from "@/server/repositories/webhook-events"

import { canUseFeature, getWorkspaceEntitlements } from "./entitlements"

export type EventOutcome =
  | { status: "duplicate" }
  | { status: "ignored"; reason: string }
  | { status: "processed"; commissionId?: string; detail: string }

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

export type IngestResult =
  | { status: "duplicate" }
  | { status: "ignored"; reason?: "live_mode_inactive" }
  | { status: "processed" }
  | { status: "failed" }

/** Workspaces whose skipped live events were logged recently: once an hour each, not per event. */
const liveSkipLoggedAt = new Map<string, number>()
const LIVE_SKIP_LOG_INTERVAL_MS = 60 * 60 * 1000

/**
 * Everything after signature verification, shared by the legacy platform
 * endpoint and the per-workspace endpoints (ARCHITECTURE.md §3.3):
 *   0. a live event for a workspace without live mode is acknowledged and NOT
 *      claimed — no `webhook_events` row — so it can be re-sent from the
 *      Stripe dashboard once the plan is active again (docs/PLANS.md §2)
 *   1. claim (scope, provider, event id): a redelivery of a processed event is
 *      a no-op; a redelivery of a FAILED one is claimed again and retried
 *   2. normalise, then hand a provider-free event to the domain
 *   3. record how the claim ended
 *
 * `workspaceId` is decided by the caller — from the endpoint for a
 * per-workspace integration, from `event.account` on the legacy route.
 */
export async function ingestVerifiedWebhook(params: {
  provider: BillingProvider
  verified: VerifiedWebhook
  rawBody: string
  workspaceId: string | null
}): Promise<IngestResult> {
  const { provider, verified, rawBody, workspaceId } = params
  const environment = verified.environment
  const log = logger.child({ provider: provider.id, eventId: verified.providerEventId })

  if (workspaceId && environment === "live" && !(await liveModeActive(workspaceId))) {
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
    providerEventId: verified.providerEventId,
    eventType: verified.rawType,
    payloadHash: hashPayload(rawBody),
    workspaceId,
    environment,
  })

  // Already received, processed or ignored by an earlier delivery — acknowledge and stop.
  if (!claim.claimed || !claim.id) {
    log.info("duplicate webhook ignored")
    return { status: "duplicate" }
  }

  if (!workspaceId) {
    await markWebhookEvent(db, claim.id, "ignored", "no workspace for connected account")
    log.warn("webhook for an unconnected account")
    return { status: "ignored" }
  }

  const normalized = provider.normalizeEvent(verified)
  if (!normalized) {
    await markWebhookEvent(db, claim.id, "ignored", `unhandled type ${verified.rawType}`)
    return { status: "ignored" }
  }

  try {
    const outcome = await handleBillingEvent(workspaceId, normalized)
    await markWebhookEvent(
      db,
      claim.id,
      outcome.status === "ignored" ? "ignored" : "processed",
      outcome.status === "ignored" ? outcome.reason : undefined,
    )

    log.info("webhook processed", { workspaceId, outcome: outcome.status })
    return { status: "processed" }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error"
    await markWebhookEvent(db, claim.id, "failed", message)
    if (error instanceof PaymentNotRecordedYetError) {
      log.warn("webhook deferred until its payment is recorded", { workspaceId })
    } else {
      log.error("webhook processing failed", { workspaceId, error })
    }
    return { status: "failed" }
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
): Promise<EventOutcome> {
  return client.transaction(async (tx) => {
    switch (event.type) {
      case "subscription.updated":
        return upsertSubscription(tx, workspaceId, event)
      case "subscription.cancelled":
        return cancelSubscription(tx, workspaceId, event)
      case "payment.succeeded":
        return recordPayment(tx, workspaceId, event, now)
      case "payment.referenced":
        return recordReferences(tx, workspaceId, event, now)
      case "payment.refunded":
        return recordRefund(tx, workspaceId, event, now)
    }
  })
}

interface ResolvedCustomer {
  id: string
  /** The founder's own id, when identify bound one — what attributions carry. */
  externalId: string | null
}

/**
 * Finds the customer a provider event belongs to, in the event's environment.
 *
 * 1. By provider customer id — what identify stores when the founder sends it.
 * 2. Otherwise by e-mail hash, when the payload has an e-mail: a customer that
 *    identify recorded with that e-mail and no provider id (or this same one)
 *    in this workspace. Exactly one must match; an ambiguous e-mail matches
 *    nothing. The provider id is then back-filled — onto the customer only if
 *    its column is still empty, and onto its bound attributions — so later
 *    payments without an e-mail match by id. A different provider id is never
 *    overwritten. (DOCS_TECHNICAL_FINDINGS.md T3.)
 * 3. Otherwise a new customer with no attribution.
 */
async function resolveCustomer(
  tx: Transaction,
  workspaceId: string,
  environment: BillingEnvironment,
  provider: BillingProviderId,
  providerCustomerId: string | null,
  email: string | null,
): Promise<ResolvedCustomer | null> {
  if (!providerCustomerId) return null

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

  if (byProvider?.externalId) return byProvider

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
      .set({ providerCustomerId, updatedAt: new Date() })
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
    return { id: byProvider?.id ?? identified.id, externalId: identified.externalId }
  }

  if (byProvider) return byProvider

  // Two events of a new customer processed at once (a PaymentIntent and its
  // invoice) both get here: the loser waits for the winner's row and reads it.
  const [created] = await tx
    .insert(customers)
    .values({ workspaceId, environment, provider, providerCustomerId, emailHash })
    .onConflictDoNothing()
    .returning({ id: customers.id })
  if (created) return { id: created.id, externalId: null }

  const [winner] = await tx
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
  return winner ?? null
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
): Promise<EventOutcome> {
  const sub = event.subscription
  const customer = await resolveCustomer(
    tx,
    workspaceId,
    event.environment,
    event.provider,
    sub.providerCustomerId,
    event.customerEmail,
  )
  const customerId = customer?.id

  if (!customerId) return { status: "ignored", reason: "subscription has no customer" }

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
async function findAttribution(
  tx: Transaction,
  workspaceId: string,
  environment: BillingEnvironment,
  customerId: string,
  providerCustomerId: string | null,
  customerExternalId: string | null,
) {
  if (!providerCustomerId && !customerExternalId) return null

  const predicates = []
  if (providerCustomerId) predicates.push(eq(attributions.providerCustomerId, providerCustomerId))
  if (customerExternalId) predicates.push(eq(attributions.customerExternalId, customerExternalId))

  const [row] = await tx
    .select({
      id: attributions.id,
      programId: attributions.programId,
      programAffiliateId: attributions.programAffiliateId,
      attributedAt: attributions.attributedAt,
      expiresAt: attributions.expiresAt,
    })
    .from(attributions)
    .innerJoin(programs, eq(programs.id, attributions.programId))
    .where(and(eq(programs.workspaceId, workspaceId), eq(programs.environment, environment), or(...predicates)))
    .orderBy(
      desc(sql`exists (
        select 1 from ${commissions}
         where ${commissions.programAffiliateId} = ${attributions.programAffiliateId}
           and ${commissions.customerId} = ${customerId}
           and ${commissions.reversalOfCommissionId} is null)`),
      desc(attributions.attributedAt),
    )
    .limit(1)

  return row ?? null
}

async function recordPayment(
  tx: Transaction,
  workspaceId: string,
  event: Extract<NormalizedBillingEvent, { type: "payment.succeeded" }>,
  now: Date,
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

  const customer = await resolveCustomer(
    tx,
    workspaceId,
    event.environment,
    event.provider,
    event.providerCustomerId,
    event.customerEmail,
  )

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
    return { status: "ignored", reason: "payment has no customer" }
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

  const attribution = await findAttribution(
    tx,
    workspaceId,
    event.environment,
    customerId,
    event.providerCustomerId,
    customer.externalId,
  )
  if (!attribution) {
    return { status: "processed", detail: "payment recorded without attribution" }
  }

  const [program] = await tx.select().from(programs).where(eq(programs.id, attribution.programId)).limit(1)

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
    .where(eq(programAffiliates.id, attribution.programAffiliateId))
    .limit(1)

  if (!program || !participation) {
    return { status: "processed", detail: "attribution points at a missing program" }
  }

  // The engine needs to know whether this is the first commissioned payment,
  // which is what drives the recurrence window. The anchor is the *payment*
  // date of that first commission, not the moment its row happened to be
  // written: a backfill or a delayed webhook would otherwise restart a
  // twelve-month clock that really started months ago.
  const [firstCommission] = await tx
    .select({ occurredAt: transactions.occurredAt })
    .from(commissions)
    .innerJoin(transactions, eq(transactions.id, commissions.transactionId))
    .where(
      and(
        eq(commissions.programAffiliateId, participation.id),
        eq(commissions.customerId, customerId),
        isNull(commissions.reversalOfCommissionId),
      ),
    )
    .orderBy(transactions.occurredAt)
    .limit(1)

  const result = calculateCommission({
    program: toProgramRules(program),
    participation: toParticipationRules(participation),
    transaction: {
      id: transaction.id,
      type: "payment",
      currency: event.currency,
      grossAmountMinor: event.amountMinor,
      occurredAt: event.occurredAt,
    },
    attribution: {
      id: attribution.id,
      programAffiliateId: attribution.programAffiliateId,
      attributedAt: attribution.attributedAt,
      expiresAt: attribution.expiresAt,
      firstCommissionedAt: firstCommission?.occurredAt ?? null,
    },
    now,
  })

  if (result.kind === "skipped") {
    logger.info("commission skipped", {
      workspaceId,
      provider: event.provider,
      eventId: event.providerEventId,
      reason: result.reason,
    })
    return { status: "processed", detail: `no commission: ${result.reason}` }
  }

  const [commission] = await tx
    .insert(commissions)
    .values({
      workspaceId,
      programId: program.id,
      programAffiliateId: participation.id,
      customerId,
      transactionId: transaction.id,
      currency: result.currency,
      baseAmountMinor: result.baseAmountMinor,
      commissionRate: result.commissionRate,
      commissionAmountMinor: result.commissionAmountMinor,
      status: result.eligibleAt <= now ? "available" : "pending",
      eligibleAt: result.eligibleAt,
      ruleApplied: result.ruleApplied,
    })
    .onConflictDoNothing()
    .returning({ id: commissions.id })

  // Keep the customer attached to the program that earned it, for reporting.
  await tx
    .update(customers)
    .set({ programId: program.id })
    .where(and(eq(customers.id, customerId), isNull(customers.programId)))

  return {
    status: "processed",
    commissionId: commission?.id,
    detail: `commission ${result.commissionAmountMinor} ${result.currency}`,
  }
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
  const refundedMinor = Math.abs(event.amountMinor)

  const [refundTransaction] = await tx
    .insert(transactions)
    .values({
      workspaceId,
      customerId: original.customerId,
      subscriptionId: original.subscriptionId,
      provider: event.provider,
      providerTransactionId: event.providerTransactionId,
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

  const [refundedBefore] = await tx
    .select({ minor: sql<number>`coalesce(sum(abs(${transactions.grossAmountMinor})), 0)::bigint`.mapWith(Number) })
    .from(transactions)
    .where(
      and(
        eq(transactions.workspaceId, workspaceId),
        eq(transactions.provider, event.provider),
        eq(transactions.providerParentTransactionId, original.providerTransactionId),
        inArray(transactions.type, ["refund", "chargeback"]),
        ne(transactions.id, refundTransaction.id),
      ),
    )

  const [reversedBefore] = await tx
    .select({ minor: sql<number>`coalesce(sum(abs(${commissions.commissionAmountMinor})), 0)::bigint`.mapWith(Number) })
    .from(commissions)
    .where(eq(commissions.reversalOfCommissionId, originalCommission.id))

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
      reversedBeforeMinor: reversedBefore?.minor ?? 0,
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
