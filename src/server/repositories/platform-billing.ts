import "server-only"

import { and, eq, or } from "drizzle-orm"

import { type DbClient } from "@/server/db"
import { workspaceSubscriptions } from "@/server/db/schema"

type NewWorkspaceSubscription = typeof workspaceSubscriptions.$inferInsert

/**
 * The billing identifiers of a workspace's subscription. Readable by members
 * under RLS (`workspace_subscriptions_member_select`); services decide who may
 * act on them.
 */
export async function findBillingAccount(tx: DbClient, workspaceId: string) {
  const [row] = await tx
    .select({
      plan: workspaceSubscriptions.plan,
      status: workspaceSubscriptions.status,
      provider: workspaceSubscriptions.provider,
      providerCustomerId: workspaceSubscriptions.providerCustomerId,
      providerSubscriptionId: workspaceSubscriptions.providerSubscriptionId,
    })
    .from(workspaceSubscriptions)
    .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
    .limit(1)
  return row ?? null
}

/**
 * Ingest path only (service connection). The workspace already tracking a
 * Stripe subscription or customer — for events whose metadata does not name one.
 */
export async function findWorkspaceByStripeRefs(
  tx: DbClient,
  refs: { subscriptionId: string; customerId: string | null },
): Promise<string | null> {
  const match = refs.customerId
    ? or(
        eq(workspaceSubscriptions.providerSubscriptionId, refs.subscriptionId),
        eq(workspaceSubscriptions.providerCustomerId, refs.customerId),
      )
    : eq(workspaceSubscriptions.providerSubscriptionId, refs.subscriptionId)
  const rows = await tx
    .select({ workspaceId: workspaceSubscriptions.workspaceId })
    .from(workspaceSubscriptions)
    .where(and(eq(workspaceSubscriptions.provider, "stripe"), match))
    .limit(2)
  // Two workspaces matching (one by subscription, one by customer) is not a guess we make.
  const ids = new Set(rows.map((row) => row.workspaceId))
  return ids.size === 1 ? rows[0]!.workspaceId : null
}

/** Ingest path only. The workspace's row, locked until the transaction ends. */
export async function lockWorkspaceSubscription(tx: DbClient, workspaceId: string) {
  const [row] = await tx
    .select()
    .from(workspaceSubscriptions)
    .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
    .limit(1)
    .for("update")
  return row ?? null
}

export type LockedWorkspaceSubscription = NonNullable<Awaited<ReturnType<typeof lockWorkspaceSubscription>>>

/**
 * Ingest path only. Inserts the row, or updates the locked one. A concurrent
 * insert for the same workspace fails on `workspace_subscriptions_workspace_key`
 * and the event is retried.
 */
export async function saveWorkspaceSubscription(
  tx: DbClient,
  existingId: string | null,
  values: Omit<NewWorkspaceSubscription, "id" | "createdAt" | "updatedAt">,
): Promise<void> {
  if (existingId) {
    await tx
      .update(workspaceSubscriptions)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(workspaceSubscriptions.id, existingId))
    return
  }
  await tx.insert(workspaceSubscriptions).values(values)
}
