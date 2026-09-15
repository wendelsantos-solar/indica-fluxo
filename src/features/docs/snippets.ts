import type { IdentifyBody } from "@/lib/api/contract"
import { stripeWebhookPath } from "@/lib/billing/stripe/events"
import { applyBasisPoints } from "@/lib/money"
import { REF_QUERY_PARAMS, TRACKER_PATH, VISITOR_COOKIE, VISITOR_COOKIE_MAX_AGE_DAYS } from "@/lib/tracking/constants"

/**
 * Every code sample in the integration guide, built from the constants the
 * API itself uses — the tracker path, cookie name, identify schema and the
 * commission arithmetic — so a sample cannot describe something the server
 * does not do. Prose is translated; code is not: a header name or JSON key is
 * the API's own vocabulary. Checked in `__tests__/snippets.test.ts`.
 */

/**
 * The quickstart starts in test mode, which works on every plan; the guide says
 * to swap in the `pk_live_`/`sk_live_` pair when going live.
 */
export const PLACEHOLDER_PUBLISHABLE_KEY = "pk_test_xxxxxxxxxxxxxxxx"
export const PLACEHOLDER_SECRET_KEY = "sk_test_xxxxxxxxxxxxxxxx"

export const TRACKER_FACTS = {
  cookie: VISITOR_COOKIE,
  cookieDays: VISITOR_COOKIE_MAX_AGE_DAYS,
  params: REF_QUERY_PARAMS,
}

export function trackerSnippet(appUrl: string): string {
  return `<script
  defer
  src="${appUrl}${TRACKER_PATH}"
  data-key="${PLACEHOLDER_PUBLISHABLE_KEY}"
></script>`
}

/** A realistic identify body; parsed against the real schema in tests. */
export const IDENTIFY_EXAMPLE: IdentifyBody = {
  visitorId: "v_k3n9q2x7m4p8r1t6w5z0",
  externalId: "user_4821",
  providerCustomerId: "cus_QX1y2Z3a4B5c6D",
  email: "ana@cliente.com",
}

export function identifyCurl(appUrl: string): string {
  return `curl -X POST ${appUrl}/api/identify \\
  -H "Authorization: Bearer ${PLACEHOLDER_SECRET_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(IDENTIFY_EXAMPLE, null, 2).replace(/\n/g, "\n  ")}'`
}

export function identifyTypeScript(appUrl: string): string {
  return `// Server-side only (route handler, server action, API). Node 18+.
const response = await fetch("${appUrl}/api/identify", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.INDICAFLUXO_SECRET_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    visitorId,                              // cookie "${VISITOR_COOKIE}" from the request
    externalId: user.id,                    // your user id
    providerCustomerId: stripeCustomer.id,  // "cus_…"
    email: user.email,                      // optional, stored hashed
  }),
})

if (!response.ok) {
  const { error } = await response.json()
  throw new Error(\`IndicaFluxo identify failed: \${error}\`)
}`
}

export const IDENTIFY_RESPONSE = `{
  "ok": true,
  "customerId": "5b1e0c9a-8f2d-4a61-9d3e-7c2b4f6a1e08",
  "attributionsBound": 1
}`

/**
 * A workspace's own Stripe endpoint. The guide cannot know the integration id,
 * so it passes a visible placeholder; Integrations shows the real URL.
 */
export function webhookUrl(appUrl: string, integrationId: string): string {
  return `${appUrl}${stripeWebhookPath(integrationId)}`
}

/** The worked commission example: a 49.00 payment on a 30% program. */
export const COMMISSION_EXAMPLE = {
  baseMinor: 4900,
  rateBps: 3000,
  commissionMinor: applyBasisPoints(4900, 3000),
}

export function commissionText(): string {
  const { baseMinor, rateBps, commissionMinor } = COMMISSION_EXAMPLE
  return `base_minor         ${baseMinor}
rate_bps           ${rateBps}
commission_minor   ${commissionMinor}   = ${baseMinor} × ${rateBps} / 10000`
}
