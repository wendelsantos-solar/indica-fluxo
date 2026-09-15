import "server-only"

import { and, desc, eq, isNull, sql } from "drizzle-orm"

import type { PlanKey } from "@/lib/plans"
import { type DbClient } from "@/server/db"
import {
  affiliates,
  planUpgradeRequests,
  programs,
  workspaceInvites,
  workspaceMembers,
  workspaces,
} from "@/server/db/schema"

export async function findWorkspacePlan(tx: DbClient, workspaceId: string): Promise<PlanKey | null> {
  const [row] = await tx
    .select({ plan: workspaces.plan })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1)
  return row?.plan ?? null
}

/** Current usage of every limited resource, in one round trip. */
export async function countPlanUsage(tx: DbClient, workspaceId: string) {
  const [row] = await tx
    .select({
      programs: sql<number>`(select count(*)::int from ${programs} where ${programs.workspaceId} = ${workspaceId})`,
      affiliates: sql<number>`(select count(*)::int from ${affiliates} where ${affiliates.workspaceId} = ${workspaceId})`,
      members: sql<number>`(
        (select count(*)::int from ${workspaceMembers} where ${workspaceMembers.workspaceId} = ${workspaceId})
        + (select count(*)::int from ${workspaceInvites}
             where ${workspaceInvites.workspaceId} = ${workspaceId} and ${workspaceInvites.acceptedAt} is null)
      )`,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
  return { programs: row?.programs ?? 0, affiliates: row?.affiliates ?? 0, members: row?.members ?? 0 }
}

export async function findOpenUpgradeRequest(tx: DbClient, workspaceId: string) {
  const [row] = await tx
    .select({
      id: planUpgradeRequests.id,
      requestedPlan: planUpgradeRequests.requestedPlan,
      createdAt: planUpgradeRequests.createdAt,
    })
    .from(planUpgradeRequests)
    .where(and(eq(planUpgradeRequests.workspaceId, workspaceId), isNull(planUpgradeRequests.handledAt)))
    .orderBy(desc(planUpgradeRequests.createdAt))
    .limit(1)
  return row ?? null
}

export async function insertUpgradeRequest(
  tx: DbClient,
  params: { workspaceId: string; requestedPlan: PlanKey; requestedBy: string },
) {
  const [row] = await tx
    .insert(planUpgradeRequests)
    .values(params)
    .onConflictDoNothing()
    .returning({ id: planUpgradeRequests.id })
  return row ?? null
}

