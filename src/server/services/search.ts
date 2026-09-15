import "server-only"

import { SEARCH_RESULT_LIMIT, toContainsPattern } from "@/lib/search"
import { withUser } from "@/server/db"
import { NotFoundError } from "@/server/policies/errors"
import { searchWorkspaceRecords, type WorkspaceSearchRows } from "@/server/repositories/search"
import { findWorkspaceBySlug } from "@/server/repositories/workspaces"

export type WorkspaceSearchResult = WorkspaceSearchRows

const EMPTY: WorkspaceSearchResult = { programs: [], affiliates: [], batches: [] }

/**
 * The command palette's lookup: programs, affiliates and payout batches of one
 * workspace whose name (or batch reference) contains the query. Runs as the
 * reader under RLS; the membership join in `findWorkspaceBySlug` turns a slug
 * the reader does not belong to into "not found" rather than an empty list.
 */
export async function searchWorkspace(
  userId: string,
  workspaceSlug: string,
  query: string,
): Promise<WorkspaceSearchResult> {
  const pattern = toContainsPattern(query)
  if (!pattern) return EMPTY

  return withUser(userId, async (tx) => {
    const workspace = await findWorkspaceBySlug(tx, workspaceSlug, userId)
    if (!workspace) {
      throw new NotFoundError("Workspace not found, or you do not have access to it.", "workspaceNotFound")
    }
    return searchWorkspaceRecords(tx, workspace.id, pattern, SEARCH_RESULT_LIMIT)
  })
}
