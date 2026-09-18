import type { IdentifyBody } from "@/lib/api/contract"
import { stripeWebhookPath } from "@/lib/billing/stripe/events"
import { BRAND } from "@/lib/brand"
import { applyBasisPoints } from "@/lib/money"
import { REF_QUERY_PARAMS, TRACKER_PATH, VISITOR_COOKIE, VISITOR_COOKIE_MAX_AGE_DAYS } from "@/lib/tracking/constants"
import { ATTRIBUTION_METADATA_KEY } from "@/lib/tracking/attribution-token"

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

/** The environment variable the samples read the secret key from, named after the brand. */
export const SECRET_KEY_ENV = `${BRAND.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_SECRET_KEY`

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
    Authorization: \`Bearer \${process.env.${SECRET_KEY_ENV}}\`,
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
  throw new Error(\`${BRAND.name} identify failed: \${error}\`)
}`
}

/**
 * Customer-first, end to end, in the smallest real form: the sign-up handler
 * reads the tracker's cookie and calls identify. No SDK — `fetch` against the
 * public route, with the fields `identifyBodySchema` accepts.
 */
export function customerFirstSnippet(appUrl: string): string {
  return `// Your sign-up handler, on your server — right after the user is created.
const visitorId = request.headers
  .get("cookie")
  ?.match(/(?:^|;\\s*)${VISITOR_COOKIE}=([^;]+)/)?.[1]

if (visitorId) {
  await fetch("${appUrl}/api/identify", {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${process.env.${SECRET_KEY_ENV}}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      visitorId,
      externalId: user.id,  // your user id
      email: user.email,    // optional, stored hashed
    }),
  })
}`
}

/**
 * Reading the visitor id where identify is called. Same domain: the tracker's
 * cookie arrives with the sign-up request (Fetch API `Request`, so it works in
 * Next.js, Remix, Hono, Bun, Deno). Another domain: the page copies
 * `window.Referral.visitorId` into the form. The tracker is `defer`red, and
 * deferred scripts run before `DOMContentLoaded`, so the value exists there.
 */
export function visitorIdFromCookie(): string {
  return `// Server: the tracker's cookie comes with the sign-up request.
const visitorId = request.headers
  .get("cookie")
  ?.match(/(?:^|;\\s*)${VISITOR_COOKIE}=([^;]+)/)?.[1]

// No cookie means the tracker never ran for this visitor: skip identify.
if (visitorId) {
  // call POST /api/identify with visitorId
}`
}

export function visitorIdFromForm(): string {
  return `<input type="hidden" name="visitorId" />

<script>
  document.addEventListener("DOMContentLoaded", function () {
    var field = document.querySelector('input[name="visitorId"]');
    if (field && window.Referral) field.value = window.Referral.visitorId;
  });
</script>`
}

/** The Stripe events to select, one per line — pasted into Stripe's event search. */
export function stripeEventsText(types: readonly string[]): string {
  return types.join("\n")
}

/** Sends a test event through the Stripe CLI; one of the handled types. */
export const STRIPE_TRIGGER_COMMAND = "stripe trigger invoice.paid"

export function identifyEndpoint(appUrl: string): string {
  return `POST ${appUrl}/api/identify`
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

/** The example as the `commissions` row stores it — real column names. */
export function commissionText(): string {
  const { baseMinor, rateBps, commissionMinor } = COMMISSION_EXAMPLE
  return `base_amount_minor         ${baseMinor}
commission_rate           ${rateBps}   -- basis points
commission_amount_minor   ${commissionMinor}   -- ${baseMinor} × ${rateBps} / 10000`
}

// ---------------------------------------------------------------------------
// How you charge (INTEGRATION_ARCHITECTURE_V2.md §4). One provider, four
// transports for the same public reference. Every snippet below shows the
// smallest change that carries it — nothing else about the founder's checkout
// has to move.
// ---------------------------------------------------------------------------

/** What the tracker exposes on every page, and the only value that travels. */
export const ATTRIBUTION_REFERENCE_EXAMPLE = "ifx_8Jd2KpQ7rT4wX1yZ6bN3mC5vH0sL9gF2aR7eU4tY1oI"

export function checkoutSessionSnippet(): string {
  return `// Your server, where you already create the Checkout Session.
const session = await stripe.checkout.sessions.create({
  mode: "subscription",
  line_items: [{ price: "price_...", quantity: 1 }],
  success_url: "https://yoursite.com/welcome",

  // The only line you add. Send what the tracker exposes in the browser:
  // window.Referral.attributionToken — null when the visitor came organically.
  client_reference_id: attributionToken ?? undefined,
})`
}

export function paymentLinkSnippet(): string {
  return `<!-- Nothing to do: the tracker adds the reference to Stripe Payment
     Links on the page by itself. This is what the visitor's browser sends. -->
<a href="https://buy.stripe.com/aEU5kQ1234">Assinar</a>
<!-- becomes -->
<a href="https://buy.stripe.com/aEU5kQ1234?client_reference_id=${ATTRIBUTION_REFERENCE_EXAMPLE}">Assinar</a>`
}

export function paymentIntentSnippet(): string {
  return `// Your server, where you already create the PaymentIntent.
const intent = await stripe.paymentIntents.create({
  amount: 4900,
  currency: "brl",
  customer: customerId, // required: a payment with no Stripe customer earns nothing
  metadata: {
    // The only line you add.
    ${ATTRIBUTION_METADATA_KEY}: attributionToken,
  },
})`
}

export function subscriptionApiSnippet(): string {
  return `// Your server, where you already create the Subscription.
// Once, at creation. Renewals carry nothing: the customer stays bound.
const subscription = await stripe.subscriptions.create({
  customer: customerId,
  items: [{ price: "price_..." }],
  metadata: { ${ATTRIBUTION_METADATA_KEY}: attributionToken },
})`
}

/** Reading the reference in the browser, to send it to your own server. */
export function attributionTokenFromBrowser(): string {
  return `// Any page with the tracker installed.
const attributionToken = window.Referral?.attributionToken ?? null

// Send it with the request that creates the checkout on your server.
await fetch("/api/checkout", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ priceId, attributionToken }),
})`
}
