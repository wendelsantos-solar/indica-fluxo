import "server-only"

import { and, asc, desc, eq, ilike } from "drizzle-orm"

import { type DbClient } from "@/server/db"
import { affiliates, payoutBatches, programs } from "@/server/db/schema"

export interface WorkspaceSearchRows {
  programs: { id: string; name: string; slug: string }[]
  affiliates: { id: string; name: string }[]
  batches: {
    id: string
    reference: string
    /** The batch month, for `formatBatchLabel`: the stored reference is English ledger data. */
    periodEnd: Date
    status: "draft" | "approved" | "paid" | "cancelled"
  }[]
}

/**
 * Name/reference lookups for the command palette, scoped to one workspace and
 * capped per group. `pattern` is an already escaped `ILIKE` pattern
 * (`lib/search.ts`); RLS still filters every row to what the reader may see.
 */
export async function searchWorkspaceRecords(
  tx: DbClient,
  workspaceId: string,
  pattern: string,
  limit: number,
): Promise<WorkspaceSearchRows> {
  const programRows = await tx
    .select({ id: programs.id, name: programs.name, slug: programs.slug })
    .from(programs)
    .where(and(eq(programs.workspaceId, workspaceId), ilike(programs.name, pattern)))
    .orderBy(asc(programs.name))
    .limit(limit)

  const affiliateRows = await tx
    .select({ id: affiliates.id, name: affiliates.name })
    .from(affiliates)
    .where(and(eq(affiliates.workspaceId, workspaceId), ilike(affiliates.name, pattern)))
    .orderBy(asc(affiliates.name))
    .limit(limit)

  const batchRows = await tx
    .select({
      id: payoutBatches.id,
      reference: payoutBatches.reference,
      periodEnd: payoutBatches.periodEnd,
      status: payoutBatches.status,
    })
    .from(payoutBatches)
    .where(and(eq(payoutBatches.workspaceId, workspaceId), ilike(payoutBatches.reference, pattern)))
    .orderBy(desc(payoutBatches.createdAt))
    .limit(limit)

  return { programs: programRows, affiliates: affiliateRows, batches: batchRows }
}
