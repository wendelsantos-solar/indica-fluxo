import "server-only"

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

import { and, eq, sql } from "drizzle-orm"

import { billingProvider } from "@/lib/billing/provider"
import { env } from "@/lib/env/server"
import { STRIPE_OAUTH_STATE_COOKIE_NAME } from "@/lib/legal/cookie-names"
import { logger } from "@/lib/logger"
import { withUser } from "@/server/db"
import { integrations } from "@/server/db/schema"
import { requireMembership } from "@/server/policies/workspace"

import { recordAudit } from "./audit"

/**
 * Connecting a Stripe account without the founder creating an endpoint,
 * selecting events or copying a signing secret.
 *
 * The founder authorises Refvia on their own Stripe account with
 * `scope=read_only`; Stripe then delivers that account's events to the
 * platform's **Connect** endpoint — `/api/webhooks/stripe`, which already
 * exists and already routes by `event.account`. Three manual steps disappear
 * and nothing about the money changes: read-only means Refvia cannot
 * charge, transfer or pay out on the account, which is the product's rule
 * anyway (INTEGRATION_ARCHITECTURE_V2.md §6).
 *
 * Manual setup stays supported and stays the default. Without
 * `STRIPE_CONNECT_CLIENT_ID` nothing here is offered.
 */

/** Whether the OAuth path can be offered at all. */
export function stripeConnectAvailable(): boolean {
  return Boolean(env().STRIPE_CONNECT_CLIENT_ID)
}

export const STRIPE_OAUTH_STATE_COOKIE = STRIPE_OAUTH_STATE_COOKIE_NAME
const STATE_TTL_MS = 10 * 60 * 1000

/**
 * CSRF state. The value Stripe echoes back is signed with `ENCRYPTION_KEY` and
 * carries the workspace and an expiry, and the same nonce is kept in an
 * HttpOnly cookie: an attacker would need both to forge a callback.
 */
function signState(payload: string): string {
  return createHmac("sha256", env().ENCRYPTION_KEY).update(payload).digest("base64url")
}

export function createStripeOAuthState(workspaceId: string): { state: string; cookie: string } {
  const nonce = randomBytes(16).toString("base64url")
  const payload = `${workspaceId}.${nonce}.${Date.now() + STATE_TTL_MS}`
  return { state: `${payload}.${signState(payload)}`, cookie: nonce }
}

export function readStripeOAuthState(
  state: string,
  cookieNonce: string | null,
): { workspaceId: string } | null {
  const parts = state.split(".")
  if (parts.length !== 4) return null
  const [workspaceId, nonce, expiresAt, signature] = parts as [string, string, string, string]

  const expected = signState(`${workspaceId}.${nonce}.${expiresAt}`)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  if (!cookieNonce || cookieNonce !== nonce) return null
  if (Number(expiresAt) < Date.now()) return null

  return { workspaceId }
}

/** The URL the "Connect with Stripe" button sends the founder to. */
export function stripeAuthorizeUrl(state: string, redirectUri: string): string {
  return billingProvider("stripe").buildConnectUrl({ state, redirectUri })
}

/**
 * Completes the connection: exchanges the one-time code for the account id and
 * stores it. No token is persisted — the account id is all the webhook router
 * needs, and holding a credential we do not use would be a liability.
 *
 * `status` becomes `connected` straight away, unlike the manual path where it
 * waits for a signing secret: with Connect there is no secret to wait for. As
 * before, "connected" means configured; whether events actually arrive is
 * `integration-health`'s answer, not this column's.
 */
export async function completeStripeConnect(
  userId: string,
  workspaceId: string,
  code: string,
): Promise<{ providerAccountId: string }> {
  const account = await billingProvider("stripe").exchangeConnectCode(code)
  const now = new Date()

  return withUser(userId, async (tx) => {
    await requireMembership(tx, workspaceId, userId, "admin")

    const [row] = await tx
      .insert(integrations)
      .values({
        workspaceId,
        provider: "stripe",
        providerAccountId: account.providerAccountId,
        status: "connected",
        connectedAt: now,
        lastVerifiedAt: now,
        metadata: { mode: "oauth", connectedAt: now.toISOString() },
      })
      // One row per Stripe account (migration 0018): connecting an account the
      // workspace already has updates it; a new account becomes a new connection.
      .onConflictDoUpdate({
        target: [integrations.workspaceId, integrations.provider, integrations.providerAccountId],
        targetWhere: sql`provider_account_id is not null and environment is null`,
        set: {
          status: "connected",
          statusReason: null,
          connectedAt: now,
          lastVerifiedAt: now,
          disconnectedAt: null,
          // Switching to OAuth drops nothing: a signing secret saved earlier
          // keeps verifying the founder's own endpoint if they still have one.
          metadata: sql`${integrations.metadata} || ${JSON.stringify({
            mode: "oauth",
            oauthConnectedAt: now.toISOString(),
          })}::jsonb`,
          updatedAt: now,
        },
      })
      .returning({ id: integrations.id })

    await recordAudit(tx, {
      workspaceId,
      actorUserId: userId,
      entityType: "integration",
      entityId: row!.id,
      action: "integration.connected",
      metadata: { provider: "stripe", mode: "oauth", integrationId: row!.id },
    })

    logger.info("stripe connected by oauth", { workspaceId })
    return { providerAccountId: account.providerAccountId }
  })
}

/** Used by the callback to confirm the account is the one the workspace holds. */
export async function integrationAccountId(
  userId: string,
  workspaceId: string,
): Promise<string | null> {
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .select({ providerAccountId: integrations.providerAccountId })
      .from(integrations)
      .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, "stripe")))
      .limit(1)
    return row?.providerAccountId ?? null
  })
}
