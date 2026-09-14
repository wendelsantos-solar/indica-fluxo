import "server-only"

import { type DbClient } from "@/server/db"
import { auditLogs } from "@/server/db/schema"

export type AuditAction =
  | "workspace.created"
  | "workspace.updated"
  | "member.invited"
  | "program.created"
  | "program.updated"
  | "affiliate.created"
  | "affiliate.approved"
  | "affiliate.rejected"
  | "affiliate.suspended"
  | "affiliate.rate_changed"
  | "link.created"
  | "commission.approved"
  | "commission.reversed"
  | "payout.created"
  | "payout.marked_paid"
  | "payout.cancelled"
  | "integration.connected"
  | "integration.disconnected"
  | "api_key.created"
  | "api_key.revoked"

/**
 * Append-only. `metadata` must never carry secrets, tokens or full payloads —
 * see CLAUDE.md. Failing to write an audit row must not fail the operation it
 * describes, but it must be visible in the logs.
 */
export async function recordAudit(
  tx: DbClient,
  params: {
    workspaceId: string
    actorUserId?: string | null
    entityType: string
    entityId?: string | null
    action: AuditAction
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  await tx.insert(auditLogs).values({
    workspaceId: params.workspaceId,
    actorUserId: params.actorUserId ?? null,
    entityType: params.entityType,
    entityId: params.entityId ?? null,
    action: params.action,
    metadata: params.metadata ?? {},
  })
}
