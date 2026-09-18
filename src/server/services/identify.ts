import "server-only"

import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm"

import { hashEmail } from "@/lib/crypto/hash"
import { attributionCustomerKey } from "@/lib/billing/identity-key"
import type { BillingProviderId } from "@/lib/billing/types"
import { logger } from "@/lib/logger"
import { db, type Transaction } from "@/server/db"
import { attributions, customers, programs } from "@/server/db/schema"
import { ValidationError } from "@/server/policies/errors"

import { customerByIdentity, linkBillingIdentity } from "./billing-identity"
import { assertLiveMode, getWorkspaceEntitlements } from "./entitlements"

export interface IdentifyInput {
  workspaceId: string
  /** From the secret key: test keys identify test customers, live keys live ones. */
  environment: "test" | "live"
  visitorId: string
  externalId: string
  providerCustomerId?: string | null
  /** Any billing provider; defaults to Stripe, as it always has. */
  provider?: BillingProviderId
  email?: string | null
}

export interface IdentifyResult {
  customerId: string
  boundAttributions: number
}

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = "23505"

/**
 * Binds an anonymous visitor to a known customer of the SaaS client.
 *
 * Authenticated by SECRET key only — a browser-supplied customer id would let
 * anyone reassign commissions, so this is strictly server-to-server
 * (ARCHITECTURE.md §3.2). The e-mail, if given, is hashed before storage and
 * the plaintext never touches a column or a log line.
 *
 * A live key needs live mode (`LIVE_MODE_REQUIRED`, or `SUBSCRIPTION_REQUIRED`
 * past the grace period); test keys work on every plan.
 */
export async function identifyCustomer(
  input: IdentifyInput,
  /** For the database-backed tests and the sandbox tests, which roll everything back. */
  client: Pick<Transaction, "transaction"> = db,
): Promise<IdentifyResult> {
  const externalId = input.externalId.trim()
  if (!externalId) {
    throw new ValidationError("externalId is required.", { externalId: ["Required."] }, "externalIdRequired")
  }

  const normalized: Normalized = {
    ...input,
    externalId,
    provider: input.provider ?? "stripe",
    providerCustomerId: input.providerCustomerId?.trim() || null,
    emailHash: input.email ? hashEmail(input.email) : null,
  }

  try {
    return await client.transaction((tx) => identifyIn(tx, normalized))
  } catch (error) {
    // Two identifies of the same new customer, or identify racing the Stripe
    // webhook that creates it: the loser sees a unique violation. Once more,
    // with the winner's row now visible, is a merge instead of an insert.
    if (isUniqueViolation(error)) return client.transaction((tx) => identifyIn(tx, normalized))
    throw error
  }
}

interface Normalized extends Omit<IdentifyInput, "provider" | "email"> {
  externalId: string
  provider: BillingProviderId
  providerCustomerId: string | null
  emailHash: string | null
}

async function identifyIn(tx: Transaction, input: Normalized): Promise<IdentifyResult> {
  const { workspaceId, environment, externalId, provider, providerCustomerId, emailHash } = input
  const now = new Date()

  if (environment === "live") assertLiveMode(await getWorkspaceEntitlements(tx, workspaceId))

  const [byExternal] = await tx
    .select({ id: customers.id, provider: customers.provider, providerCustomerId: customers.providerCustomerId })
    .from(customers)
    .where(
      and(
        eq(customers.workspaceId, workspaceId),
        eq(customers.environment, environment),
        eq(customers.externalId, externalId),
      ),
    )
    .limit(1)
    .for("update")

  // Who already holds this provider customer: its identity (any provider), or
  // — for rows from before identities — the legacy columns on `customers`.
  const identityKey = providerCustomerId ? { workspaceId, environment, provider, providerCustomerId } : null
  const byIdentity = identityKey ? await customerByIdentity(tx, identityKey) : null
  const [byLegacy] =
    providerCustomerId && !byIdentity
      ? await tx
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
          .for("update")
      : []
  const byProvider = byIdentity ?? byLegacy ?? null

  // The provider id may be written onto the identified row's legacy columns
  // only when that row is for the same provider and no other row holds the id
  // (the unique key); an id already stored is never replaced or cleared by a
  // later call without one. Other providers live in `billing_identities` only.
  const providerIdFree = !byProvider || byProvider.id === byExternal?.id
  const sameProvider = !byExternal || byExternal.provider === provider

  let customerId: string

  if (byExternal) {
    const [row] = await tx
      .update(customers)
      .set({
        providerCustomerId:
          providerIdFree && sameProvider
            ? sql`coalesce(${customers.providerCustomerId}, ${providerCustomerId})`
            : sql`${customers.providerCustomerId}`,
        emailHash: sql`coalesce(${emailHash}, ${customers.emailHash})`,
        updatedAt: now,
      })
      .where(eq(customers.id, byExternal.id))
      .returning({ id: customers.id })
    customerId = row!.id
  } else if (byProvider && !byProvider.externalId) {
    // The provider got there first: a webhook created the customer from its
    // provider id. Attach the founder's id to that row instead of inserting a
    // second one (which the unique key on the provider id would refuse).
    const [row] = await tx
      .update(customers)
      .set({ externalId, emailHash: sql`coalesce(${emailHash}, ${customers.emailHash})`, updatedAt: now })
      .where(eq(customers.id, byProvider.id))
      .returning({ id: customers.id })
    customerId = row!.id
  } else {
    if (byProvider) {
      // The provider customer already belongs to another of the founder's ids.
      // It is not taken over; this customer is recorded without it.
      logger.warn("identify: provider customer already bound to another external id", { workspaceId, provider })
    }
    const [row] = await tx
      .insert(customers)
      .values({
        workspaceId,
        environment,
        externalId,
        provider,
        providerCustomerId: byProvider ? null : providerCustomerId,
        emailHash,
      })
      .returning({ id: customers.id })
    customerId = row!.id
  }

  // One customer, N provider identities. First link wins (never moved here).
  const identityOwner =
    identityKey && providerIdFree ? await linkBillingIdentity(tx, identityKey, customerId) : null
  const [stored] = await tx
    .select({ provider: customers.provider, providerCustomerId: customers.providerCustomerId })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1)
  // What the attributions carry: this call's provider customer when it is now
  // this customer's, else the one the row already held (as before).
  const storedProviderCustomerId =
    identityKey && identityOwner === customerId
      ? attributionCustomerKey(provider, identityKey.providerCustomerId)
      : stored?.providerCustomerId
        ? attributionCustomerKey(stored.provider, stored.providerCustomerId)
        : null

  // Bind this visitor's attributions in programs of the same environment: the
  // open ones (not yet bound, window not expired), and those already bound to
  // this same customer, which a repeated identify may complete. A provider id
  // already on an attribution is kept.
  const bound = await tx
    .update(attributions)
    .set({
      customerExternalId: externalId,
      providerCustomerId: sql`coalesce(${attributions.providerCustomerId}, ${storedProviderCustomerId})`,
      updatedAt: now,
    })
    .where(
      and(
        eq(attributions.visitorId, input.visitorId),
        or(
          and(isNull(attributions.customerExternalId), gt(attributions.expiresAt, now)),
          eq(attributions.customerExternalId, externalId),
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

  logger.info("customer identified", { workspaceId, environment, boundAttributions: bound.length })

  return { customerId, boundAttributions: bound.length }
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (typeof current === "object" && (current as { code?: unknown }).code === UNIQUE_VIOLATION) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}
