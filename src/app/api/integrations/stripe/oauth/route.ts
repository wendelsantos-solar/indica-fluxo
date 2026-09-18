import { NextResponse, type NextRequest } from "next/server"

import { logger } from "@/lib/logger"
import { appUrl } from "@/lib/site"
import { getVerifiedSessionUser } from "@/server/auth/session"
import {
  createStripeOAuthState,
  stripeAuthorizeUrl,
  stripeConnectAvailable,
  STRIPE_OAUTH_STATE_COOKIE,
} from "@/server/services/stripe-connect"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Starts "Connect with Stripe" (INTEGRATION_ARCHITECTURE_V2.md §6).
 *
 * Route Handler contract: parse → authenticate → authorize → service → respond.
 * Under `/api`, so the proxy does not gate it — `getVerifiedSessionUser()`
 * rather than `getSessionUser()`.
 */
export const STRIPE_OAUTH_CALLBACK_PATH = "/api/integrations/stripe/oauth/callback"

export async function GET(request: NextRequest) {
  if (!stripeConnectAvailable()) {
    return NextResponse.json({ error: "stripe_connect_unavailable" }, { status: 404 })
  }

  const slug = request.nextUrl.searchParams.get("workspace")
  if (!slug) return NextResponse.json({ error: "invalid_payload" }, { status: 400 })

  const user = await getVerifiedSessionUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  // Membership (and its 404-for-outsiders behaviour) comes from the service.
  const workspace = await getWorkspaceForUser(user.id, slug)

  const { state, cookie } = createStripeOAuthState(workspace.id)
  const redirectUri = new URL(STRIPE_OAUTH_CALLBACK_PATH, appUrl()).toString()

  const response = NextResponse.redirect(stripeAuthorizeUrl(state, redirectUri))
  response.cookies.set(STRIPE_OAUTH_STATE_COOKIE, cookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: appUrl().protocol === "https:",
    path: "/",
    maxAge: 600,
  })

  logger.info("stripe oauth started", { workspaceId: workspace.id })
  return response
}
