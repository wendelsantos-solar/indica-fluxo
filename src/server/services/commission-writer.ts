import "server-only"

import { and, desc, eq, isNull, or, sql } from "drizzle-orm"

import { logger } from "@/lib/logger"
import { attributionCustomerKey } from "@/lib/billing/identity-key"
import { reasonForSkip, type ReasonCode } from "@/lib/billing/reasons"
import type { BillingEnvironment, BillingProviderId } from "@/lib/billing/types"
import type { Transaction } from "@/server/db"
import { attributions, commissions, customers, programAffiliates, programs, transactions } from "@/server/db/schema"
import { calculateCommission } from "@/server/domain/commission"
import { toParticipationRules } from "@/server/repositories/affiliates"
import { toProgramRules } from "@/server/repositories/programs"

/**
 * "A recorded payment becomes a commission" — once, in one place.
 *
 * Extracted from `billing-events.ts` when the attribution bridge gained a
 * second, equally legitimate caller: a bind that arrives after the payment it
 * belongs to. Stripe orders nothing, so both orderings have to produce exactly
 * the same commission row, and the only way to guarantee that is to have one
 * implementation (INTEGRATION_ARCHITECTURE_V2.md §5).
 *
 * It lives here rather than in either caller so neither has to import the other.
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

/**
 * The one implementation of "a recorded payment becomes a commission".
 *
 * Called by `recordPayment` for a payment that has just entered the ledger, and
 * by the attribution bridge for payments that were already there when the bind
 * arrived — Stripe does not order its events, so
 * `checkout.session.completed` may land after `invoice.paid`
 * (INTEGRATION_ARCHITECTURE_V2.md §5). Both callers must produce the same row,
 * which is why there is no second copy of this logic.
 *
 * Idempotent through `commissions_transaction_participation_key`: running it
 * twice for the same transaction and participation inserts nothing the second
 * time. It never touches `transactions`.
 */
export async function commissionForTransaction(
  tx: Transaction,
  workspaceId: string,
  input: {
    transactionId: string
    customerId: string
    environment: BillingEnvironment
    /** Namespaces the provider customer id the way attributions store it. */
    provider: BillingProviderId
    providerCustomerId: string | null
    customerExternalId: string | null
    currency: string
    grossAmountMinor: number
    occurredAt: Date
    eventId?: string
  },
  now: Date,
): Promise<{ commissionId?: string; detail: string; code?: ReasonCode }> {
  const { customerId } = input

  const attribution = await findAttribution(
    tx,
    workspaceId,
    input.environment,
    customerId,
    input.providerCustomerId ? attributionCustomerKey(input.provider, input.providerCustomerId) : null,
    input.customerExternalId,
  )
  if (!attribution) {
    // Normal: an organic customer. Diagnostics tell it apart from a broken
    // integration by whether the customer has any attribution at all.
    return { detail: "payment recorded without attribution", code: "NO_ATTRIBUTION" }
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
    return { detail: "attribution points at a missing program" }
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
      id: input.transactionId,
      type: "payment",
      currency: input.currency,
      grossAmountMinor: input.grossAmountMinor,
      occurredAt: input.occurredAt,
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
    logger.info("commission skipped", { workspaceId, eventId: input.eventId, reason: result.reason })
    return { detail: `no commission: ${result.reason}`, code: reasonForSkip(result.reason) }
  }

  const [commission] = await tx
    .insert(commissions)
    .values({
      workspaceId,
      programId: program.id,
      programAffiliateId: participation.id,
      customerId,
      transactionId: input.transactionId,
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

  logger.info("commission created", {
    workspaceId,
    eventId: input.eventId,
    transactionId: input.transactionId,
    customerId,
    attributionId: attribution.id,
    commissionId: commission?.id ?? null,
  })
  return {
    commissionId: commission?.id,
    detail: `commission ${result.commissionAmountMinor} ${result.currency}`,
  }
}
