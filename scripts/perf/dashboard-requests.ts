/**
 * The server-side data loads of one founder-dashboard navigation, mirrored
 * from `app/[locale]/(dashboard)/[workspaceSlug]/layout.tsx` and
 * `.../overview/page.tsx` without the parts that need a request (cookies,
 * Supabase Auth, React). Keep it in step with those two files, or the bench
 * measures a request that no longer exists.
 *
 * React's `cache()` only memoises inside a render, so the per-request sharing
 * the pages get (`getWorkspaceForUser`, `getWorkspaceStanding`) is reproduced
 * with one memo per navigation.
 */
import { resolveViewEnvironment } from "@/lib/view-environment"
import { withUser } from "@/server/db"
import { listAffiliates, userHasParticipation } from "@/server/repositories/affiliates"
import {
  getConversionFunnel,
  getDashboardOverview,
  getRecentConversions,
  getRevenueSeries,
  getTopAffiliates,
  workspaceHasLivePrograms,
} from "@/server/repositories/analytics"
import { listPrograms } from "@/server/repositories/programs"
import { findWorkspaceBySlug, listWorkspacesForUser } from "@/server/repositories/workspaces"
import { getWorkspaceEntitlements } from "@/server/services/entitlements"
import { getIntegrationHealth } from "@/server/services/integration-health"

type Memo = Map<string, Promise<unknown>>
const once = <T>(memo: Memo, key: string, load: () => Promise<T>) => {
  if (!memo.has(key)) memo.set(key, load())
  return memo.get(key) as Promise<T>
}

// `services/workspaces` imports the i18n navigation (and with it `next/navigation`),
// which cannot load outside Next.js; its two reads are reproduced here verbatim.
const listUserWorkspaces = (memo: Memo, userId: string) =>
  once(memo, "workspaces", () => withUser(userId, (tx) => listWorkspacesForUser(tx, userId)))
const getWorkspaceForUser = (memo: Memo, userId: string, slug: string) =>
  once(memo, `workspace:${slug}`, async () => {
    const workspace = await withUser(userId, (tx) => findWorkspaceBySlug(tx, slug, userId))
    if (!workspace) throw new Error("workspace not found")
    return workspace
  })
const getWorkspaceStanding = (memo: Memo, userId: string, workspaceId: string) =>
  once(memo, `standing:${workspaceId}`, async () => {
    const [entitlements, hasLivePrograms] = await withUser(userId, (tx) =>
      Promise.all([getWorkspaceEntitlements(tx, workspaceId), workspaceHasLivePrograms(tx, workspaceId)]),
    )
    return { entitlements, hasLivePrograms }
  })

/** `getViewEnvironment` without `cookies()`: no stored preference. */
async function viewEnvironment(memo: Memo, userId: string, workspaceId: string) {
  const { entitlements, hasLivePrograms } = await getWorkspaceStanding(memo, userId, workspaceId)
  const liveModeAvailable = entitlements.capabilities.features.liveMode
  return { ...resolveViewEnvironment({ requested: undefined, liveModeAvailable, hasLivePrograms }), liveModeAvailable }
}

export async function loadDashboardLayout(userId: string, slug: string, memo: Memo = new Map()) {
  const [workspaces, isAffiliate] = await Promise.all([
    listUserWorkspaces(memo, userId),
    withUser(userId, (tx) => userHasParticipation(tx, userId)),
  ])
  if (!workspaces.some((workspace) => workspace.slug === slug)) throw new Error("not a member")
  const workspace = await getWorkspaceForUser(memo, userId, slug)
  const [{ entitlements }, environment] = await Promise.all([
    getWorkspaceStanding(memo, userId, workspace.id),
    viewEnvironment(memo, userId, workspace.id),
  ])
  return { workspaces, workspace, isAffiliate, entitlements, environment }
}

export async function loadOverview(userId: string, slug: string, memo: Memo = new Map()) {
  const workspace = await getWorkspaceForUser(memo, userId, slug)
  const { environment } = await viewEnvironment(memo, userId, workspace.id)
  const period = { days: 30, timeZone: workspace.timezone, now: new Date() }

  return Promise.all([
    getIntegrationHealth(userId, workspace.id),
    withUser(userId, async (tx) => {
      const overview = await getDashboardOverview(tx, workspace.id, environment, period)
      return Promise.all([
        getRevenueSeries(tx, workspace.id, environment, overview.currency, period),
        getConversionFunnel(tx, workspace.id, environment, period),
        getTopAffiliates(tx, workspace.id, environment),
        getRecentConversions(tx, workspace.id, environment),
        listPrograms(tx, workspace.id),
        listAffiliates(tx, { workspaceId: workspace.id, limit: 1 }),
      ])
    }),
  ])
}

/** One navigation: layout and page render concurrently and share the request's memo. */
export function loadNavigation(userId: string, slug: string) {
  const memo: Memo = new Map()
  return Promise.all([loadDashboardLayout(userId, slug, memo), loadOverview(userId, slug, memo)])
}
