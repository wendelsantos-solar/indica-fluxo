import "server-only"

import { and, eq } from "drizzle-orm"

import { logger } from "@/lib/logger"
import type { BillingEnvironment, BillingProviderId } from "@/lib/billing/types"
import type { Transaction } from "@/server/db"
import { billingIdentities, customers } from "@/server/db/schema"

/**
 * One customer, N provider identities — the one writer of `billing_identities`
 * (UNIVERSAL_ATTRIBUTION_ARCHITECTURE.md §2).
 *
 * Runs on the service connection only: the webhook ingest path and
 * `POST /api/identify`, both authenticated by the provider or a secret key.
 * `billing_identities` has no client write policy.
 */

export interface IdentityKey {
  workspaceId: string
  environment: BillingEnvironment
  provider: BillingProviderId
  providerCustomerId: string
}

export interface IdentifiedCustomer {
  id: string
  /** The SaaS's own id, when identify or a checkout said it. */
  externalId: string | null
}

function keyWhere(key: IdentityKey) {
  return and(
    eq(billingIdentities.workspaceId, key.workspaceId),
    eq(billingIdentities.environment, key.environment),
    eq(billingIdentities.provider, key.provider),
    eq(billingIdentities.providerCustomerId, key.providerCustomerId),
  )
}

/** The customer this provider identity belongs to, if we have seen it. */
export async function customerByIdentity(tx: Transaction, key: IdentityKey): Promise<IdentifiedCustomer | null> {
  const [row] = await tx
    .select({ id: customers.id, externalId: customers.externalId })
    .from(billingIdentities)
    .innerJoin(customers, eq(customers.id, billingIdentities.customerId))
    .where(keyWhere(key))
    .limit(1)
  return row ?? null
}

/**
 * Records that `key` is `customerId`. First link wins: an identity already
 * owned by another customer is NOT moved (a customer is never merged
 * implicitly) unless `repoint` says the caller has proof — the SaaS's own
 * customer id — that the earlier owner was a placeholder.
 *
 * Returns the customer that owns the identity afterwards.
 */
export async function linkBillingIdentity(
  tx: Transaction,
  key: IdentityKey,
  customerId: string,
  options: { integrationId?: string | null; repoint?: boolean } = {},
): Promise<string> {
  const [inserted] = await tx
    .insert(billingIdentities)
    .values({ ...key, customerId, integrationId: options.integrationId ?? null })
    .onConflictDoNothing()
    .returning({ customerId: billingIdentities.customerId })
  if (inserted) return inserted.customerId

  const [existing] = await tx
    .select({ id: billingIdentities.id, customerId: billingIdentities.customerId })
    .from(billingIdentities)
    .where(keyWhere(key))
    .limit(1)
    .for("update")
  if (!existing) return customerId
  if (existing.customerId === customerId) return customerId

  if (options.repoint) {
    await tx
      .update(billingIdentities)
      .set({ customerId, lastSeenAt: new Date() })
      .where(eq(billingIdentities.id, existing.id))
    logger.info("billing identity moved to the customer the SaaS named", {
      workspaceId: key.workspaceId,
      provider: key.provider,
    })
    return customerId
  }
  return existing.customerId
}

/** The customer row of the SaaS's own id in one environment, if identify or a checkout created it. */
export async function customerByExternalId(
  tx: Transaction,
  workspaceId: string,
  environment: BillingEnvironment,
  externalId: string,
): Promise<IdentifiedCustomer | null> {
  const [row] = await tx
    .select({ id: customers.id, externalId: customers.externalId })
    .from(customers)
    .where(
      and(
        eq(customers.workspaceId, workspaceId),
        eq(customers.environment, environment),
        eq(customers.externalId, externalId),
      ),
    )
    .limit(1)
  return row ?? null
}
