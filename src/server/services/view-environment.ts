import "server-only"

import { cookies } from "next/headers"
import { cache } from "react"

import {
  resolveViewEnvironment,
  viewEnvironmentCookie,
  type ResolvedViewEnvironment,
  type ViewEnvironment,
} from "@/lib/view-environment"
import { withUser } from "@/server/db"
import { workspaceHasLivePrograms } from "@/server/repositories/analytics"

import { getWorkspaceEntitlements } from "./entitlements"

/**
 * The workspace's plan standing and whether it holds live programs — read once
 * per request and shared by the layout (billing banner) and every
 * `getViewEnvironment` call. Both statements go out together on the
 * transaction's connection (postgres.js pipelines them).
 */
export const getWorkspaceStanding = cache(async (userId: string, workspaceId: string) => {
  const [entitlements, hasLivePrograms] = await withUser(userId, (tx) =>
    Promise.all([getWorkspaceEntitlements(tx, workspaceId), workspaceHasLivePrograms(tx, workspaceId)]),
  )
  return { entitlements, hasLivePrograms }
})

export interface WorkspaceViewEnvironment extends ResolvedViewEnvironment {
  /** The plan includes live mode now. A switchable workspace without it holds read-only live data. */
  liveModeAvailable: boolean
}

/**
 * The environment the founder dashboard shows for one workspace: the reader's
 * choice (a per-workspace cookie, a preference and never an authorisation)
 * resolved against the plan — see `resolveViewEnvironment`. The layout and
 * every page of a request call this; `cache` makes it one lookup per request.
 *
 * Callers have already resolved the workspace through `getWorkspaceForUser`,
 * so membership is established; the reads here run as the user under RLS.
 */
export const getViewEnvironment = cache(
  async (userId: string, workspaceId: string): Promise<WorkspaceViewEnvironment> => {
    const store = await cookies()
    const requested = store.get(viewEnvironmentCookie(workspaceId))?.value
    const { entitlements, hasLivePrograms } = await getWorkspaceStanding(userId, workspaceId)
    const liveModeAvailable = entitlements.capabilities.features.liveMode
    return { ...resolveViewEnvironment({ requested, liveModeAvailable, hasLivePrograms }), liveModeAvailable }
  },
)

export type { ViewEnvironment }
