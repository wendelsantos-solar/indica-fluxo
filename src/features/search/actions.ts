"use server"

import { z } from "zod"

import { logger } from "@/lib/logger"
import { requireUser } from "@/server/auth/session"
import { searchWorkspace, type WorkspaceSearchResult } from "@/server/services/search"

const schema = z.object({
  workspaceSlug: z.string().min(1).max(100),
  // Cut to the searchable length by the service; this only bounds the payload.
  query: z.string().max(500),
})

const EMPTY: WorkspaceSearchResult = { programs: [], affiliates: [], batches: [] }

/**
 * Palette search. A lookup, not a mutation: any failure — a bad payload, a
 * revoked membership — answers with no results, and the palette keeps showing
 * its own commands.
 */
export async function searchWorkspaceAction(input: {
  workspaceSlug: string
  query: string
}): Promise<WorkspaceSearchResult> {
  const user = await requireUser()
  const parsed = schema.safeParse(input)
  if (!parsed.success) return EMPTY

  try {
    return await searchWorkspace(user.id, parsed.data.workspaceSlug, parsed.data.query)
  } catch (error) {
    logger.warn("palette search failed", { error: error instanceof Error ? error.message : "unknown" })
    return EMPTY
  }
}
