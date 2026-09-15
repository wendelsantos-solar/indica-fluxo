import "server-only"

import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm"

import { hashEmail, hashPayload } from "@/lib/crypto/hash"
import { logger } from "@/lib/logger"
import type {
  BillingProvider,
  BillingProviderId,
  NormalizedBillingEvent,
  VerifiedWebhook,
} from "@/lib/billing/types"
import { db, type Transaction } from "@/server/db"
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
  webhookEvents,
} from "@/server/db/schema"
import { calculateCommission, isFullyRefunded, planReversal } from "@/server/domain/commission"
import { toProgramRules } from "@/server/repositories/programs"
import { toParticipationRules } from "@/server/repositories/affiliates"

export type EventOutcome =
  | { status: "duplicate" }
  | { status: "ignored"; reason: string }
  | { status: "processed"; commissionId?: string; detail: string }

/**
 * Claims a provider event exactly once.
 *
 * `INSERT … ON CONFLICT DO NOTHING RETURNING id` is the idempotency gate: if
 * nothing comes back, another delivery already owns this event and we return
 * 200 without doing any work. See ARCHITECTURE.md §3.3.
 */
export async function claimWebhookEvent(params: {
  provider: BillingProviderId
  providerEventId: string
  eventType: string
  rawBody: string
  workspaceId: string | null
}): Promise<string | null> {
  const [row] = await db
    .insert(webhookEvents)
    .values({
      provider: params.provider,
      providerEventId: params.providerEventId,
      eventType: params.eventType,
      payloadHash: hashPayload(params.rawBody),
      workspaceId: params.workspaceId,
      status: "received",
    })
    .onConflictDoNothing({
      target: [webhookEvents.provider, webhookEvents.providerEventId],
    })
    .returning({ id: webhookEvents.id })

  return row?.id ?? null
}

export async function finishWebhookEvent(
  webhookEventId: string,
  status: "processed" | "failed" | "ignored",
  errorMessage?: string,
): Promise<void> {
  await db
    .update(webhookEvents)
    .set({
      status,
      processedAt: new Date(),
      errorMessage: errorMessage?.slice(0, 500) ?? null,
    })
    .where(eq(webhookEvents.id, webhookEventId))
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
    .where(
      and(
        eq(integrations.provider, provider),
        eq(integrations.providerAccountId, providerAccountId),
      ),
    )
    .limit(1)

  return row?.workspaceId ?? null
}

export type IngestResult =
  | { status: "duplicate" }
  | { status: "ignored" }
  | { status: "processed" }
  | { status: "failed" }

/**
 * Everything after signature verification, shared by the legacy platform
 * endpoint and the per-workspace endpoints (ARCHITECTURE.md §3.3):
 *   1. claim (provider, event id) so a redelivery is a no-op
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
  const log = logger.child({ provider: provider.id, eventId: verified.providerEventId })

  const webhookEventId = await claimWebhookEvent({
    provider: provider.id,
    providerEventId: verified.providerEventId,
    eventType: verified.rawType,
    rawBody,
    workspaceId,
  })

  // Already claimed by an earlier delivery — acknowledge and stop.
  if (!webhookEventId) {
    log.info("duplicate webhook ignored")
    return { status: "duplicate" }
  }

  if (!workspaceId) {
    await finishWebhookEvent(webhookEventId, "ignored", "no workspace for connected account")
    log.warn("webhook for an unconnected account")
    return { status: "ignored" }
  }

  const normalized = provider.normalizeEvent(verified)
  if (!normalized) {
    await finishWebhookEvent(webhookEventId, "ignored", `unhandled type ${verified.rawType}`)
    return { status: "ignored" }
  }

  try {
    const outcome = await handleBillingEvent(workspaceId, normalized)
    await finishWebhookEvent(
      webhookEventId,
      outcome.status === "ignored" ? "ignored" : "processed",
      outcome.status === "ignored" ? outcome.reason : undefined,
    )

    log.info("webhook processed", { workspaceId, outcome: outcome.status })
    return { status: "processed" }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error"
    await finishWebhookEvent(webhookEventId, "failed", message)
    log.error("webhook processing failed", { workspaceId, error })
    return { status: "failed" }
  }
}

/**
 * Turns a normalised billing event into ledger facts. Runs on the service
 * connection (the caller is Stripe, not a user) inside one transaction, so a
 * failure half-way leaves nothing behind for a retry to trip over.
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
        return recordReferences(tx, workspaceId, event)
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
 * Finds the customer a provider event belongs to.
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
        eq(customers.provider, provider),
        eq(customers.providerCustomerId, providerCustomerId),
      ),
    )
    .limit(1)

  if (byProvider?.externalId) return byProvider

  const emailHash = email ? hashEmail(email) : null
  const identified = emailHash
    ? await identifiedCustomerByEmail(tx, workspaceId, provider, emailHash, providerCustomerId)
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
            tx.select({ id: programs.id }).from(programs).where(eq(programs.workspaceId, workspaceId)),
          ),
        ),
      )

    logger.info("customer matched by e-mail hash", { workspaceId, provider })
    // A row the webhook created earlier (e.g. from a subscription event with no
    // e-mail) keeps owning the ledger rows; the attribution comes from identify.
    return { id: byProvider?.id ?? identified.id, externalId: identified.externalId }
  }

  if (byProvider) return byProvider

  const [created] = await tx
    .insert(customers)
    .values({ workspaceId, provider, providerCustomerId, emailHash })
    .returning({ id: customers.id })

  return created ? { id: created.id, externalId: null } : null
}

async function identifiedCustomerByEmail(
  tx: Transaction,
  workspaceId: string,
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

/** Remembers every id of a payment, pointing at the id it is recorded under. */
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

/** The recorded payment any of `references` names, directly or through `transaction_references`. */
async function findPaymentByReferences(
  tx: Transaction,
  workspaceId: string,
  provider: BillingProviderId,
  references: string[],
) {
  if (references.length === 0) return null

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

  const [row] = await tx
    .select({
      id: transactions.id,
      customerId: transactions.customerId,
      subscriptionId: transactions.subscriptionId,
      currency: transactions.currency,
      providerTransactionId: transactions.providerTransactionId,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.workspaceId, workspaceId),
        eq(transactions.provider, provider),
        eq(transactions.type, "payment"),
        or(
          inArray(transactions.providerTransactionId, references),
          inArray(transactions.providerTransactionId, linked),
        ),
      ),
    )
    .orderBy(transactions.occurredAt)
    .limit(1)

  return row ?? null
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

/** Resolves the affiliate that should be credited for a provider customer. */
async function findAttribution(
  tx: Transaction,
  workspaceId: string,
  providerCustomerId: string | null,
  customerExternalId: string | null,
) {
  if (!providerCustomerId && !customerExternalId) return null

  const predicates = []
  if (providerCustomerId) {
    predicates.push(eq(attributions.providerCustomerId, providerCustomerId))
  }
  if (customerExternalId) {
    predicates.push(eq(attributions.customerExternalId, customerExternalId))
  }

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
    .where(
      and(
        eq(programs.workspaceId, workspaceId),
        predicates.length === 1 ? predicates[0] : sql`(${predicates[0]} or ${predicates[1]})`,
      ),
    )
    .orderBy(desc(attributions.attributedAt))
    .limit(1)

  return row ?? null
}

async function recordPayment(
  tx: Transaction,
  workspaceId: string,
  event: Extract<NormalizedBillingEvent, { type: "payment.succeeded" }>,
  now: Date,
): Promise<EventOutcome> {
  const customer = await resolveCustomer(
    tx,
    workspaceId,
    event.provider,
    event.providerCustomerId,
    event.customerEmail,
  )

  if (!customer) return { status: "ignored", reason: "payment has no customer" }
  const customerId = customer.id

  // The same money already recorded under another of its ids — a one-off
  // PaymentIntent event for a payment already recorded as its invoice, once
  // `invoice_payment.paid` has linked them. Remember the ids; record nothing.
  const recordedAs = await findPaymentByReferences(tx, workspaceId, event.provider, [
    event.providerTransactionId,
    ...event.providerReferences,
  ])
  if (recordedAs && recordedAs.providerTransactionId !== event.providerTransactionId) {
    await saveReferences(tx, workspaceId, event.provider, recordedAs.providerTransactionId, [
      event.providerTransactionId,
      ...event.providerReferences,
    ])
    return { status: "processed", detail: `payment already recorded as ${recordedAs.providerTransactionId}` }
  }

  const [subscription] = event.providerSubscriptionId
    ? await tx
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.workspaceId, workspaceId),
            eq(subscriptions.providerSubscriptionId, event.providerSubscriptionId),
          ),
        )
        .limit(1)
    : []

  // Second idempotency barrier: unique on (workspace, provider, provider id).
  const [transaction] = await tx
    .insert(transactions)
    .values({
      workspaceId,
      customerId,
      subscriptionId: subscription?.id ?? null,
      provider: event.provider,
      providerTransactionId: event.providerTransactionId,
      type: "payment",
      status: "succeeded",
      currency: event.currency,
      grossAmountMinor: event.amountMinor,
      occurredAt: event.occurredAt,
    })
    .onConflictDoNothing({
      target: [
        transactions.workspaceId,
        transactions.provider,
        transactions.providerTransactionId,
      ],
    })
    .returning({ id: transactions.id })

  await saveReferences(tx, workspaceId, event.provider, event.providerTransactionId, event.providerReferences)

  if (!transaction) {
    return { status: "processed", detail: "transaction already recorded" }
  }

  const attribution = await findAttribution(tx, workspaceId, event.providerCustomerId, customer.externalId)
  if (!attribution) {
    return { status: "processed", detail: "payment recorded without attribution" }
  }

  const [program] = await tx
    .select()
    .from(programs)
    .where(eq(programs.id, attribution.programId))
    .limit(1)

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

/** `invoice_payment.paid`: links an invoice to the PaymentIntent and charge that paid it. */
async function recordReferences(
  tx: Transaction,
  workspaceId: string,
  event: Extract<NormalizedBillingEvent, { type: "payment.referenced" }>,
): Promise<EventOutcome> {
  await saveReferences(tx, workspaceId, event.provider, event.providerTransactionId, event.providerReferences)

  // A PaymentIntent recorded as its own payment before this link arrived is
  // the same money twice. The ledger is not rewritten; say so loudly.
  const [duplicate] = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.workspaceId, workspaceId),
        eq(transactions.provider, event.provider),
        eq(transactions.type, "payment"),
        inArray(transactions.providerTransactionId, event.providerReferences),
      ),
    )
    .limit(1)
  if (duplicate) {
    logger.warn("payment recorded under both an invoice and its PaymentIntent", {
      workspaceId,
      provider: event.provider,
      eventId: event.providerEventId,
    })
  }

  return { status: "processed", detail: "payment references linked" }
}

/**
 * Refunds and disputes never delete. Each one — a partial refund included — is
 * its own transaction under the refund or dispute id, found through any id of
 * the payment it undoes, and inserts a negative reversal row proportional to
 * its amount. The original flips to `reversed` only once refunds cover the
 * whole payment, and never when it is already `paid` (CLAUDE.md rule 9; the
 * statuses are decided by `planReversal`).
 */
async function recordRefund(
  tx: Transaction,
  workspaceId: string,
  event: Extract<NormalizedBillingEvent, { type: "payment.refunded" }>,
  now: Date,
): Promise<EventOutcome> {
  const original = await findPaymentByReferences(tx, workspaceId, event.provider, event.paymentReferences)

  if (!original) {
    return { status: "ignored", reason: "refund references an unknown payment" }
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
      currency: event.currency,
      grossAmountMinor: -refundedMinor,
      occurredAt: event.occurredAt,
    })
    .onConflictDoNothing({
      target: [
        transactions.workspaceId,
        transactions.provider,
        transactions.providerTransactionId,
      ],
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

  const [program] = await tx
    .select()
    .from(programs)
    .where(eq(programs.id, originalCommission.programId))
    .limit(1)

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

  // The original row survives; at most its status changes. History is preserved.
  if (plan.flipOriginal) {
    await tx
      .update(commissions)
      .set({ status: "reversed", reversedAt: now, updatedAt: now })
      .where(eq(commissions.id, originalCommission.id))
  }

  // Earlier partial rows were payable to net against the original; with the
  // original reversed they would subtract from nothing.
  if (plan.settlePriorReversals && reversal) {
    await tx
      .update(commissions)
      .set({ status: "reversed", updatedAt: now })
      .where(
        and(
          eq(commissions.reversalOfCommissionId, originalCommission.id),
          inArray(commissions.status, ["pending", "available"]),
          ne(commissions.id, reversal.id),
        ),
      )
  }

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
