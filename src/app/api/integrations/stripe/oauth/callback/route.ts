import { NextResponse, type NextRequest } from "next/server"

import { logger } from "@/lib/logger"
import { appUrl } from "@/lib/site"
import { getVerifiedSessionUser } from "@/server/auth/session"
import { getWorkspaceForUser, listUserWorkspaces } from "@/server/services/workspaces"
import {
  completeStripeConnect,
  readStripeOAuthState,
  stripeConnectAvailable,
  STRIPE_OAUTH_STATE_COOKIE,
} from "@/server/services/stripe-connect"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Where Stripe sends the founder back. Verifies the signed `state` against the
 * nonce cookie before anything else, exchanges the one-time code for the
 * account id, and returns to Integrations with an outcome in the query string —
 * the page renders the message from the catalogues, never from here.
 */
function back(slug: string | null, status: string): NextResponse {
  const target = slug
    ? new URL(`/pt-br/${slug}/integrations`, appUrl())
    : new URL("/pt-br/app", appUrl())
  target.searchParams.set("stripe", status)
  const response = NextResponse.redirect(target)
  response.cookies.delete(STRIPE_OAUTH_STATE_COOKIE)
  return response
}

export async function GET(request: NextRequest) {
  if (!stripeConnectAvailable()) {
    return NextResponse.json({ error: "stripe_connect_unavailable" }, { status: 404 })
  }

  const params = request.nextUrl.searchParams
  const state = params.get("state")
  if (!state) return back(null, "failed")

  const verified = readStripeOAuthState(state, request.cookies.get(STRIPE_OAUTH_STATE_COOKIE)?.value ?? null)
  if (!verified) {
    logger.warn("stripe oauth callback with an invalid state")
    return back(null, "failed")
  }

  const user = await getVerifiedSessionUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  // The state carries a workspace id; the slug for the redirect comes from the
  // user's own memberships, so a signed state can never point somewhere they
  // cannot open.
  const workspaces = await listUserWorkspaces(user.id)
  const slug = workspaces.find((workspace) => workspace.id === verified.workspaceId)?.slug ?? null
  if (!slug) return back(null, "failed")

  // The founder declined on Stripe's page: not an error, just nothing to do.
  if (params.get("error")) return back(slug, "cancelled")

  const code = params.get("code")
  if (!code) return back(slug, "failed")

  try {
    const workspace = await getWorkspaceForUser(user.id, slug)
    await completeStripeConnect(user.id, workspace.id, code)
    return back(slug, "connected")
  } catch (error) {
    logger.error("stripe oauth exchange failed", { error })
    return back(slug, "failed")
  }
}
