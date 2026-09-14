import "server-only"

import { and, count, desc, eq, sql } from "drizzle-orm"

import { type DbClient } from "@/server/db"
import { qualified } from "@/server/db/qualify"
import { commissions, programAffiliates, programs, referralClicks } from "@/server/db/schema"
import type { ProgramRules } from "@/server/domain/types"

export type ProgramRow = typeof programs.$inferSelect

export async function listPrograms(tx: DbClient, workspaceId: string) {
  return tx
    .select({
      id: programs.id,
      name: programs.name,
      slug: programs.slug,
      description: programs.description,
      status: programs.status,
      commissionType: programs.commissionType,
      commissionValue: programs.commissionValue,
      commissionDurationMonths: programs.commissionDurationMonths,
      attributionModel: programs.attributionModel,
      attributionWindowDays: programs.attributionWindowDays,
      commissionHoldDays: programs.commissionHoldDays,
      currency: programs.currency,
      createdAt: programs.createdAt,
      affiliateCount: sql<number>`(
        select count(*)::int from ${programAffiliates}
         where ${programAffiliates.programId} = ${qualified(programs.id)}
           and ${programAffiliates.status} = 'approved'
      )`,
      clickCount: sql<number>`(
        select count(*)::int from ${referralClicks}
         where ${referralClicks.programId} = ${qualified(programs.id)}
      )`,
      commissionTotalMinor: sql<number>`coalesce((
        select sum(${commissions.commissionAmountMinor})::bigint from ${commissions}
         where ${commissions.programId} = ${qualified(programs.id)}
           and ${commissions.status} <> 'rejected'
      ), 0)::int`,
    })
    .from(programs)
    .where(eq(programs.workspaceId, workspaceId))
    .orderBy(desc(programs.createdAt))
}

export async function findProgramBySlug(tx: DbClient, workspaceId: string, slug: string) {
  const [row] = await tx
    .select()
    .from(programs)
    .where(and(eq(programs.workspaceId, workspaceId), eq(programs.slug, slug)))
    .limit(1)
  return row ?? null
}

export async function findProgramById(tx: DbClient, programId: string) {
  const [row] = await tx.select().from(programs).where(eq(programs.id, programId)).limit(1)
  return row ?? null
}

export async function countPrograms(tx: DbClient, workspaceId: string): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(programs)
    .where(eq(programs.workspaceId, workspaceId))
  return row?.value ?? 0
}

/** Maps a persisted program onto the pure domain shape the engine consumes. */
export function toProgramRules(row: ProgramRow): ProgramRules {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    currency: row.currency,
    commissionType: row.commissionType,
    commissionValue: row.commissionValue,
    commissionDurationMonths: row.commissionDurationMonths,
    attributionModel: row.attributionModel,
    attributionWindowDays: row.attributionWindowDays,
    commissionHoldDays: row.commissionHoldDays,
  }
}
