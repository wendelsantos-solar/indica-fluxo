import "server-only"

import { and, desc, eq, isNull, sql } from "drizzle-orm"

import { hashEmail, hashPayload } from "@/lib/crypto/hash"
import { logger } from "@/lib/logger"
import type { BillingProviderId, NormalizedBillingEvent } from "@/lib/billing/types"
import { db, type Transaction } from "@/server/db"
import {
  attributions,
  commissions,
  customers,
  integrations,
  programAffiliates,
  programs,
  subscriptions,
  transactions,
  webhookEvents,
} from "@/server/db/schema"
import { calculateCommission } from "@/server/domain/commission"
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

/** Maps a connected provider account to the workspace that owns it. */
export async function workspaceForProviderAccount(
  provider: BillingProviderId,
  providerAccountId: string | null,
): Promise<string | null> {
  if (!providerAccountId) {
    // Single-tenant / test mode: fall back to the only connected workspace.
    const rows = await db
      .select({ workspaceId: integrations.workspaceId })
      .from(integrations)
      .where(and(eq(integrations.provider, provider), eq(integrations.status, "connected")))
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

/**
 * Turns a normalised billing event into ledger facts. Runs on the service
 * connection (the caller is Stripe, not a user) inside one transaction, so a
 * failure half-way leaves nothing behind for a retry to trip over.
 */
export async function handleBillingEvent(
  workspaceId: string,
  event: NormalizedBillingEvent,
  now = new Date(),
): Promise<EventOutcome> {
  return db.transaction(async (tx) => {
    switch (event.type) {
      case "subscription.updated":
        return upsertSubscription(tx, workspaceId, event)
      case "subscription.cancelled":
        return cancelSubscription(tx, workspaceId, event)
      case "payment.succeeded":
        return recordPayment(tx, workspaceId, event, now)
      case "payment.refunded":
        return recordRefund(tx, workspaceId, event, now)
    }
  })
}

async function ensureCustomer(
  tx: Transaction,
  workspaceId: string,
  provider: BillingProviderId,
  providerCustomerId: string | null,
  email: string | null,
): Promise<string | null> {
  if (!providerCustomerId) return null

  const [existing] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(
      and(
        eq(customers.workspaceId, workspaceId),
        eq(customers.provider, provider),
        eq(customers.providerCustomerId, providerCustomerId),
      ),
    )
    .limit(1)

  if (existing) return existing.id

  const [created] = await tx
    .insert(customers)
    .values({
      workspaceId,
      provider,
      providerCustomerId,
      emailHash: email ? hashEmail(email) : null,
    })
    .returning({ id: customers.id })

  return created?.id ?? null
}

async function upsertSubscription(
  tx: Transaction,
  workspaceId: string,
  event: Extract<NormalizedBillingEvent, { type: "subscription.updated" }>,
): Promise<EventOutcome> {
  const sub = event.subscription
  const customerId = await ensureCustomer(
    tx,
    workspaceId,
    event.provider,
    sub.providerCustomerId,
    event.customerEmail,
  )

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
  const customerId = await ensureCustomer(
    tx,
    workspaceId,
    event.provider,
    event.providerCustomerId,
    event.customerEmail,
  )

  if (!customerId) return { status: "ignored", reason: "payment has no customer" }

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

  if (!transaction) {
    return { status: "processed", detail: "transaction already recorded" }
  }

  const attribution = await findAttribution(tx, workspaceId, event.providerCustomerId, null)
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

/**
 * Refunds never delete. They insert a negative reversal row and flip the
 * original to `reversed`, so the ledger keeps its history (CLAUDE.md rule 9).
 */
async function recordRefund(
  tx: Transaction,
  workspaceId: string,
  event: Extract<NormalizedBillingEvent, { type: "payment.refunded" }>,
  now: Date,
): Promise<EventOutcome> {
  const parentId = event.providerParentTransactionId
  const [original] = parentId
    ? await tx
        .select({
          id: transactions.id,
          customerId: transactions.customerId,
          subscriptionId: transactions.subscriptionId,
          currency: transactions.currency,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.workspaceId, workspaceId),
            eq(transactions.providerTransactionId, parentId),
          ),
        )
        .limit(1)
    : []

  if (!original) {
    return { status: "ignored", reason: "refund references an unknown payment" }
  }

  const [refundTransaction] = await tx
    .insert(transactions)
    .values({
      workspaceId,
      customerId: original.customerId,
      subscriptionId: original.subscriptionId,
      provider: event.provider,
      providerTransactionId: event.providerTransactionId,
      providerParentTransactionId: parentId,
      type: event.isChargeback ? "chargeback" : "refund",
      status: "succeeded",
      currency: event.currency,
      grossAmountMinor: -Math.abs(event.amountMinor),
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
    })
    .from(commissions)
    .where(and(eq(commissions.transactionId, original.id), isNull(commissions.reversalOfCommissionId)))
    .limit(1)

  if (!originalCommission) {
    return { status: "processed", detail: "refund recorded; no commission to reverse" }
  }

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
      type: event.isChargeback ? "chargeback" : "refund",
      currency: event.currency,
      grossAmountMinor: -Math.abs(event.amountMinor),
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
    },
    now,
  })

  if (result.kind === "skipped") {
    return { status: "processed", detail: `refund recorded: ${result.reason}` }
  }

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
      status: "reversed",
      eligibleAt: result.eligibleAt,
      reversalOfCommissionId: originalCommission.id,
      ruleApplied: result.ruleApplied,
      reversedAt: now,
    })
    .returning({ id: commissions.id })

  // The original row survives; only its status changes. History is preserved.
  await tx
    .update(commissions)
    .set({ status: "reversed", reversedAt: now, updatedAt: now })
    .where(eq(commissions.id, originalCommission.id))

  return {
    status: "processed",
    commissionId: reversal?.id,
    detail: `reversed ${result.commissionAmountMinor} ${result.currency}`,
  }
}
