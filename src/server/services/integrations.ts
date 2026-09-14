import "server-only"

import { and, eq } from "drizzle-orm"

import type { BillingProviderId } from "@/lib/billing/types"
import { withUser } from "@/server/db"
import { integrations } from "@/server/db/schema"
import { requireMembership } from "@/server/policies/workspace"

import { recordAudit } from "./audit"

export async function listIntegrations(
  tx: Parameters<Parameters<typeof withUser>[1]>[0],
  workspaceId: string,
) {
  return tx
    .select({
      id: integrations.id,
      provider: integrations.provider,
      status: integrations.status,
      providerAccountId: integrations.providerAccountId,
      connectedAt: integrations.connectedAt,
      disconnectedAt: integrations.disconnectedAt,
    })
    .from(integrations)
    .where(eq(integrations.workspaceId, workspaceId))
}

export async function connectIntegration(
  userId: string,
  workspaceId: string,
  provider: BillingProviderId,
  providerAccountId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

    await tx
      .insert(integrations)
      .values({
        workspaceId,
        provider,
        providerAccountId,
        status: "connected",
        connectedAt: new Date(),
        disconnectedAt: null,
        metadata,
      })
      .onConflictDoUpdate({
        target: [integrations.workspaceId, integrations.provider],
        set: {
          providerAccountId,
          status: "connected",
          connectedAt: new Date(),
          disconnectedAt: null,
          metadata,
          updatedAt: new Date(),
        },
      })

    await recordAudit(tx, {
      workspaceId,
      actorUserId: userId,
      entityType: "integration",
      action: "integration.connected",
      metadata: { provider },
    })
  })
}

export async function disconnectIntegration(
  userId: string,
  workspaceId: string,
  provider: BillingProviderId,
): Promise<void> {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

    await tx
      .update(integrations)
      .set({
        status: "disconnected",
        disconnectedAt: new Date(),
        // Credentials are dropped on disconnect; nothing to leak afterwards.
        encryptedCredentials: null,
      })
      .where(
        and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, provider)),
      )

    await recordAudit(tx, {
      workspaceId,
      actorUserId: userId,
      entityType: "integration",
      action: "integration.disconnected",
      metadata: { provider },
    })
  })
}
