import "server-only"

import { type DbClient, withUser } from "@/server/db"
import { auditLogs } from "@/server/db/schema"
import { requireMembership } from "@/server/policies/workspace"
import { listRecentAuditLogs } from "@/server/repositories/audit"

import { assertPlanFeature } from "./plans"

/** Every action this module can record, for callers that label them. */
export const AUDIT_ACTIONS = [
  "workspace.created",
  "workspace.updated",
  "member.invited",
  "member.role_changed",
  "member.removed",
  "member.invite_revoked",
  "program.created",
  "program.updated",
  "affiliate.created",
  "affiliate.approved",
  "affiliate.rejected",
  "affiliate.suspended",
  "affiliate.rate_changed",
  "link.created",
  "commission.approved",
  "commission.reversed",
  "payout.created",
  "payout.marked_paid",
  "payout.cancelled",
  "integration.connected",
  "integration.disconnected",
  "api_key.created",
  "api_key.revoked",
  "plan.upgrade_requested",
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

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

export const AUDIT_LOG_PAGE_SIZE = 50

export interface AuditLogEntry {
  id: string
  action: string
  entityType: string
  actorUserId: string | null
  actorName: string | null
  createdAt: Date
}

/**
 * The workspace's recent audit trail for Settings. Owners and admins only —
 * RLS lets any member read `audit_logs`, but the trail names who changed rates
 * and payouts, which is an administrative view. Gated by plan (Growth).
 */
export async function listAuditLog(userId: string, workspaceId: string): Promise<AuditLogEntry[]> {
  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")
    await assertPlanFeature(tx, workspaceId, "auditLog")
    return listRecentAuditLogs(tx, workspaceId, AUDIT_LOG_PAGE_SIZE)
  })
}
