import "server-only"

import { and, asc, eq, gt, inArray, isNull, notExists, or, sql } from "drizzle-orm"

import { generateAttributionToken, peppered } from "@/lib/crypto/hash"
import { logger } from "@/lib/logger"
import { attributionCustomerKey } from "@/lib/billing/identity-key"
import type { BillingEnvironment, BillingProviderId } from "@/lib/billing/types"
import { isAttributionToken } from "@/lib/tracking/attribution-token"
import type { Transaction } from "@/server/db"
import { attributions, attributionTokens, commissions, customers, programs, transactions } from "@/server/db/schema"

import { customerByExternalId, customerByIdentity, linkBillingIdentity } from "./billing-identity"
import { commissionForTransaction } from "./commission-writer"

/**
 * The bridge between a referral and a payment.
 *
 * It exists so a founder does not have to write code. A click mints a public
 * reference; the reference travels through whatever checkout they use; the
 * webhook hands it back, and this module turns it into the same binding
 * `POST /api/identify` would have written — `attributions.provider_customer_id`
 * — which is all the ledger has ever needed (INTEGRATION_ARCHITECTURE_V2.md §2).
 *
 * Nothing here knows about Checkout Sessions, Payment Links, Elements or
 * Subscriptions. It receives a token and a provider customer id; where they
 * were found in a payload is the adapter's problem.
 */

/** How long a token stays resolvable when the program sets no shorter window. */
const MAX_TOKEN_DAYS = 365

export interface IssueTokenInput {
  workspaceId: string
  environment: BillingEnvironment
  visitorId: string
  /** The token the tracker already holds, if any. Reused when it is still ours and still valid. */
  presented?: string | null
  /** The attribution window of the program whose click is being recorded. */
  windowDays: number
}

/**
 * Mints — or extends — the visitor's public reference.
 *
 * Called from inside `recordClick`'s transaction, and only for a click that
 * produced or touched an attribution: a token's existence is itself the
 * statement "this visitor has an eligible attribution", so one is never issued
 * to a visitor who would earn nothing.
 *
 * The tracker presents the token it already has, which keeps this table at one
 * row per visitor per window instead of one row per click.
 */
export async function issueAttributionToken(
  tx: Transaction,
  input: IssueTokenInput,
): Promise<{ token: string | null; reused: boolean }> {
  const days = Math.min(Math.max(input.windowDays, 1), MAX_TOKEN_DAYS)
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)

  if (input.presented && isAttributionToken(input.presented)) {
    // Extending is scoped: a token from another workspace or the other
    // environment is not "already valid", it is simply not ours to extend.
    const [extended] = await tx
      .update(attributionTokens)
      .set({ expiresAt, updatedAt: new Date() })
      .where(
        and(
          eq(attributionTokens.tokenHash, peppered(input.presented)),
          eq(attributionTokens.workspaceId, input.workspaceId),
          eq(attributionTokens.environment, input.environment),
          eq(attributionTokens.visitorId, input.visitorId),
          sql`${attributionTokens.expiresAt} <= ${expiresAt}`,
        ),
      )
      .returning({ id: attributionTokens.id })
    if (extended) return { token: input.presented, reused: true }
  }

  const minted = generateAttributionToken()
  await tx.insert(attributionTokens).values({
    workspaceId: input.workspaceId,
    environment: input.environment,
    visitorId: input.visitorId,
    tokenHash: minted.hash,
    tokenPrefix: minted.prefix,
    expiresAt,
  })

  return { token: minted.plaintext, reused: false }
}

/**
 * Why a bind did or did not happen. Named rather than silent: an integration
 * that looks correct and earns nothing is the failure this whole rework exists
 * to remove (INTEGRATION_ARCHITECTURE_V2.md §9).
 */
export type BindOutcome =
  /** The reference resolved and this visitor's open attributions now carry the customer. */
  | { status: "bound"; customerId: string; attributionsBound: number }
  /** The same reference and the same customer, again. A redelivery. */
  | { status: "already_bound"; customerId: string }
  /** No such reference in this workspace and environment. Not an error: it may be someone else's cart id. */
  | { status: "token_unknown" }
  /** The reference exists but its attribution window has passed. */
  | { status: "token_expired" }
  /** The reference is already bound to a different customer. The first bind keeps the money. */
  | { status: "token_conflict" }

export interface BindInput {
  workspaceId: string
  environment: BillingEnvironment
  provider: BillingProviderId
  token: string
  providerCustomerId: string
  /** Optional e-mail hash, only used when the customer row has to be created here. */
  emailHash?: string | null
  /** The billing connection the event arrived on, recorded on the identity. */
  integrationId?: string | null
}

/**
 * Turns a public reference plus a provider customer into a bound attribution.
 *
 * Deliberately writes only `attributions.provider_customer_id`, never
 * `customer_external_id`: a Stripe customer has no id in the founder's own
 * system, and inventing one would collide with the unique key on
 * `customers.external_id` (INTEGRATION_ARCHITECTURE_AUDIT.md §7).
 *
 * First bind wins. A second bind of the same reference to a different customer
 * is refused, mirroring the renewal lock in `tracking.ts`: once an affiliate
 * has earned a customer, a later signal never moves them silently.
 */
export async function bindAttributionToken(tx: Transaction, input: BindInput): Promise<BindOutcome> {
  const { workspaceId, environment, provider, providerCustomerId } = input
  const now = new Date()
  // What `bound_provider_customer_id` and `attributions.provider_customer_id`
  // store: bare for Stripe (every existing row), namespaced for other providers.
  const boundKey = attributionCustomerKey(provider, providerCustomerId)

  if (!isAttributionToken(input.token)) return { status: "token_unknown" }

  // Serialised per reference: two events of the same checkout (the session and
  // its PaymentIntent) can arrive at once, and both would otherwise decide from
  // the same read that the token is unbound.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`attribution-token:${workspaceId}:${input.token.slice(0, 32)}`}, 0))`,
  )

  const [row] = await tx
    .select({
      id: attributionTokens.id,
      visitorId: attributionTokens.visitorId,
      expiresAt: attributionTokens.expiresAt,
      bound: attributionTokens.boundProviderCustomerId,
    })
    .from(attributionTokens)
    .where(
      and(
        eq(attributionTokens.tokenHash, peppered(input.token)),
        eq(attributionTokens.workspaceId, workspaceId),
        eq(attributionTokens.environment, environment),
      ),
    )
    .limit(1)

  if (!row) return { status: "token_unknown" }
  // An expired reference may still be re-presented by a redelivery of the event
  // that already bound it; that is not an expiry, it is the same bind.
  if (!row.bound && row.expiresAt <= now) return { status: "token_expired" }

  // Customer-first (UNIVERSAL_ATTRIBUTION_ARCHITECTURE.md §3): the visitor this
  // reference belongs to was identified by the SaaS. The provider customer is
  // that customer — whichever provider it is, and even if an earlier bind made
  // with another provider holds the reference. This is the provider-switch path.
  const identified = await identifiedCustomerOfVisitor(tx, workspaceId, environment, row.visitorId)
  if (identified) {
    const owner = await linkBillingIdentity(
      tx,
      { workspaceId, environment, provider, providerCustomerId },
      identified,
      { integrationId: input.integrationId },
    )
    if (!row.bound) {
      await tx
        .update(attributionTokens)
        .set({ boundProviderCustomerId: boundKey, boundAt: now, updatedAt: now })
        .where(eq(attributionTokens.id, row.id))
    }
    if (owner === identified) {
      logger.info("attribution reference linked to an identified customer", { workspaceId, environment, provider })
      return row.bound === boundKey
        ? { status: "already_bound", customerId: owner }
        : { status: "bound", customerId: owner, attributionsBound: 0 }
    }
    // The provider identity already belongs to another customer: never moved.
    return { status: "token_conflict" }
  }

  if (row.bound && row.bound !== boundKey) {
    logger.warn("attribution reference already bound to another customer", { workspaceId, environment })
    return { status: "token_conflict" }
  }

  const customerId = await ensureCustomer(tx, {
    workspaceId,
    environment,
    provider,
    providerCustomerId,
    emailHash: input.emailHash ?? null,
    integrationId: input.integrationId ?? null,
  })

  const bound = await tx
    .update(attributions)
    .set({ providerCustomerId: boundKey, updatedAt: now })
    .where(
      and(
        eq(attributions.visitorId, row.visitorId),
        or(
          // Open: nothing has claimed this attribution yet.
          and(isNull(attributions.providerCustomerId), isNull(attributions.customerExternalId), gt(attributions.expiresAt, now)),
          // Already ours — a redelivery, or identify wrote the external id first.
          eq(attributions.providerCustomerId, boundKey),
        ),
        inArray(
          attributions.programId,
          tx
            .select({ id: programs.id })
            .from(programs)
            .where(and(eq(programs.workspaceId, workspaceId), eq(programs.environment, environment))),
        ),
      ),
    )
    .returning({ id: attributions.id })

  if (row.bound === boundKey) {
    return { status: "already_bound", customerId }
  }

  await tx
    .update(attributionTokens)
    .set({ boundProviderCustomerId: boundKey, boundAt: now, updatedAt: now })
    .where(eq(attributionTokens.id, row.id))

  logger.info("attribution reference bound", { workspaceId, environment, attributionsBound: bound.length })
  return { status: "bound", customerId, attributionsBound: bound.length }
}

/**
 * The customer the SaaS identified this visitor as (`POST /api/identify`
 * wrote `customer_external_id` on its attributions), in this environment.
 */
async function identifiedCustomerOfVisitor(
  tx: Transaction,
  workspaceId: string,
  environment: BillingEnvironment,
  visitorId: string,
): Promise<string | null> {
  const [attribution] = await tx
    .select({ externalId: attributions.customerExternalId })
    .from(attributions)
    .innerJoin(programs, eq(programs.id, attributions.programId))
    .where(
      and(
        eq(attributions.visitorId, visitorId),
        eq(programs.workspaceId, workspaceId),
        eq(programs.environment, environment),
        sql`${attributions.customerExternalId} is not null`,
      ),
    )
    .orderBy(sql`${attributions.updatedAt} desc`)
    .limit(1)
  if (!attribution?.externalId) return null
  return (await customerByExternalId(tx, workspaceId, environment, attribution.externalId))?.id ?? null
}

/**
 * The customer for a provider identity, created if this is the first time we
 * see it: by identity, then by the legacy provider id on `customers`, then a
 * new row. The identity is written in every case. Same race handling as the
 * webhook path: two events of a new customer may run at once.
 */
async function ensureCustomer(
  tx: Transaction,
  input: {
    workspaceId: string
    environment: BillingEnvironment
    provider: BillingProviderId
    providerCustomerId: string
    emailHash: string | null
    integrationId: string | null
  },
): Promise<string> {
  const key = {
    workspaceId: input.workspaceId,
    environment: input.environment,
    provider: input.provider,
    providerCustomerId: input.providerCustomerId,
  }
  const known = await customerByIdentity(tx, key)
  if (known) return known.id

  const where = and(
    eq(customers.workspaceId, input.workspaceId),
    eq(customers.environment, input.environment),
    eq(customers.provider, input.provider),
    eq(customers.providerCustomerId, input.providerCustomerId),
  )

  const [existing] = await tx.select({ id: customers.id }).from(customers).where(where).limit(1)
  let customerId = existing?.id ?? null

  if (!customerId) {
    const [created] = await tx
      .insert(customers)
      .values({
        workspaceId: input.workspaceId,
        environment: input.environment,
        provider: input.provider,
        providerCustomerId: input.providerCustomerId,
        emailHash: input.emailHash,
      })
      .onConflictDoNothing()
      .returning({ id: customers.id })
    customerId = created?.id ?? (await tx.select({ id: customers.id }).from(customers).where(where).limit(1))[0]!.id
  }

  return linkBillingIdentity(tx, key, customerId, { integrationId: input.integrationId })
}

/**
 * Commissions for payments that were already in the ledger when the bind
 * arrived.
 *
 * Stripe orders nothing: `checkout.session.completed` can land after
 * `invoice.paid`, and without this the customer's very first payment would be
 * recorded with no commission and stay that way — silently, which is exactly
 * the failure mode this architecture is meant to end.
 *
 * Idempotent: it only looks at payments that have no commission, and inserts
 * through `commissions_transaction_participation_key`. It never creates or
 * changes a `transactions` row, so it cannot produce a duplicate payment.
 */
export async function commissionsForBoundCustomer(
  tx: Transaction,
  workspaceId: string,
  input: {
    customerId: string
    environment: BillingEnvironment
    provider: BillingProviderId
    providerCustomerId: string | null
    customerExternalId: string | null
  },
  now: Date,
): Promise<number> {
  const pending = await tx
    .select({
      id: transactions.id,
      currency: transactions.currency,
      grossAmountMinor: transactions.grossAmountMinor,
      occurredAt: transactions.occurredAt,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.workspaceId, workspaceId),
        eq(transactions.customerId, input.customerId),
        eq(transactions.environment, input.environment),
        eq(transactions.type, "payment"),
        eq(transactions.status, "succeeded"),
        notExists(
          tx
            .select({ one: sql`1` })
            .from(commissions)
            .where(and(eq(commissions.transactionId, transactions.id), isNull(commissions.reversalOfCommissionId))),
        ),
      ),
    )
    // Oldest first: the recurrence window is anchored on the first commissioned
    // payment, so a backfill must walk the payments in the order they happened.
    .orderBy(asc(transactions.occurredAt))

  let created = 0
  for (const payment of pending) {
    const outcome = await commissionForTransaction(
      tx,
      workspaceId,
      {
        transactionId: payment.id,
        customerId: input.customerId,
        environment: input.environment,
        provider: input.provider,
        providerCustomerId: input.providerCustomerId,
        customerExternalId: input.customerExternalId,
        currency: payment.currency,
        grossAmountMinor: Number(payment.grossAmountMinor),
        occurredAt: payment.occurredAt,
      },
      now,
    )
    if (outcome.commissionId) created += 1
  }

  if (created > 0) {
    logger.info("commissions created for a late attribution bind", { workspaceId, created })
  }
  return created
}
