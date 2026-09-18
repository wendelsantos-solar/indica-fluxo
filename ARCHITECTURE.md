# ARCHITECTURE.md

**Read this before creating a module, a boundary, an adapter or a service.**

---

## 1. Shape

A **modular monolith** on Next.js App Router. One deployable. No `/apps/api`,
no microservices, no queue broker, no Redis. The modularity is enforced by
*import direction*, not by network hops.

```
┌───────────────────────────────────────────────────────────────┐
│  app/           routes, layouts, server components (UI only)  │
├───────────────────────────────────────────────────────────────┤
│  features/*     server actions, view models, feature UI        │
├───────────────────────────────────────────────────────────────┤
│  server/services  domain use-cases, transactions, authorization│
│  server/policies  "can this actor do this?" — pure predicates   │
├───────────────────────────────────────────────────────────────┤
│  server/repositories   SQL. The only place Drizzle is imported │
├───────────────────────────────────────────────────────────────┤
│  server/db  ·  lib/billing/*  ·  lib/supabase/*                │
└───────────────────────────────────────────────────────────────┘
```

### The dependency rule

```
UI → features/actions → services → repositories → db / providers
```

Allowed to import downward. **Never upward.** Concretely:

| Forbidden | Why |
| --- | --- |
| `repositories` importing from `features` or `app` | inverts the graph |
| a React component importing `drizzle-orm` or `server/db` | leaks SQL into render |
| `import Stripe` anywhere outside `lib/billing/stripe/` and `lib/platform-billing/stripe/` | locks us to one provider |
| a Route Handler containing calculation logic | untestable, unreusable |
| `server/domain/*` importing anything with I/O | kills pure unit tests |

`src/server/db/index.ts`, every repository and every service starts with
`import "server-only"`. If a client component ever transitively imports one, the
build fails loudly instead of shipping a secret.

### Where logic is allowed to live

| Layer | May contain | Must not contain |
| --- | --- | --- |
| `app/**/page.tsx` | layout, composition, `await` a read-model query | branching business rules |
| `app/api/**/route.ts` | parse → validate → authenticate → call service → respond | > ~40 lines of anything else |
| `features/*/actions.ts` | `"use server"`, Zod parse, session lookup, service call, `revalidatePath` | SQL |
| `server/services/*` | orchestration, DB transactions, authorization, audit logging | HTTP, React, Stripe types |
| `server/domain/*` | **pure functions** — commission maths, attribution resolution | I/O of any kind |
| `server/repositories/*` | Drizzle queries, mapping rows → domain types | business rules |

`server/domain/` is the crown jewel: the commission engine and the attribution
resolver are pure, synchronous, dependency-free functions. That is what makes
the money-critical paths cheap to test exhaustively.

---

## 2. Multi-tenancy

```
auth.users ─1:1─ profiles
     │
     └─< workspace_members >─ workspaces ─< programs ─< program_affiliates >─ affiliates
```

Three actor types:

1. **Founder / team member** — belongs to workspaces via `workspace_members`
   (`owner` | `admin` | `member`). Scoped by `workspace_id`.
2. **Affiliate** — an `affiliates` row whose `user_id` matches the session.
   Sees only their own participation, clicks, conversions, commissions, payouts.
3. **Machine** — a workspace API key (`sk_live_…`) presented to the server API,
   or a provider webhook signature. Never a session.

Isolation is enforced **twice**:

- **Postgres RLS** on every tenant table (see `DATABASE.md` §6). This is the
  real boundary — it holds even if application code has a bug.
- **Application policies** in `server/policies/` for readable errors and for
  role checks RLS can't express well (e.g. "only `owner` may delete a workspace").

RLS is bypassed in exactly two mechanisms, and they are not the same thing:

1. **The Drizzle service connection** (`DATABASE_URL`, `server/db/index.ts`).
   Confined to three call sites, each of which documents why it must:
   `server/services/tracking.ts` (anonymous click writes), `app/api/webhooks/stripe`
   and `app/api/webhooks/stripe/[integrationId]` (provider-authenticated reads
   and writes: the integration's encrypted signing secret, `webhook_events`,
   the ledger), `app/api/platform-billing/stripe/webhook` via
   `server/services/platform-billing.ts` (Stripe-authenticated writes to
   `workspace_subscriptions`, which `indica_app` can only read), and
   `server/db/seed` (development only).
   Everything else goes through `withUser()` / `withAnon()`, which downgrade to
   the `authenticated` / `anon` role so Postgres policies stay the boundary.
2. **The Supabase admin client** (`SUPABASE_SECRET_KEY`, `lib/supabase/admin.ts`).
   Reserved for administrative Supabase API calls that have no user session at
   all (Auth Admin operations, maintenance scripts). Its call sites are
   `server/db/seed/auth.ts`, which provisions demo logins, and
   `server/services/invite-mail.ts`, which sends affiliate and teammate
   invitations with `auth.admin.inviteUserByEmail` after the inviting service
   has authorised an owner/admin. Adding another requires a comment stating why
   the operation cannot run under RLS.

An affiliate is scoped to a workspace (`affiliates.workspace_id`). The same
human working with two SaaS companies has two `affiliates` rows joined by
`user_id`. This is a deliberate deviation from a globally shared affiliate
entity: it keeps tenant isolation expressible as a single column predicate, and
prevents one workspace from probing another's affiliate list by e-mail.

---

## 3. Request flows

### 3.1 Tracking a click

```
visitor → cliente.com/?ref=wendel
            │  tracker.js (no React, no framework)
            ▼
       POST /api/track   { publicKey, ref, visitorId, url, referrer, utm* }
            │  Zod parse · public-key lookup (not revoked) · rate limit per IP
            ▼
       TrackingService.recordClick()
            │  key environment → only programs of that environment
            │  live program without live mode → nothing recorded (204)
            │  resolve program_affiliate by code (unique per workspace)
            │  insert referral_clicks
            │  lock + upsert attribution  ← domain/attribution (pure)
            │  (an attribution already bound to a customer keeps its affiliate)
            ▼
       204
```

The visitor id and the `_referral_id` cookie (365 days, `SameSite=Lax`) are
written by the tracker itself, on the customer's domain — a first-party cookie.
The API sets no cookie.

The tracker is plain TypeScript compiled to a standalone script served from
`/t.js`. It knows nothing about React. `/api/track` contains no business logic,
so the whole endpoint can be lifted to an edge worker later without touching
`server/domain/attribution.ts`.

### 3.2 Binding a visitor to a customer

There are two ways in, and they write the same thing:
`attributions.provider_customer_id`, which is how the webhook later finds the
affiliate. Everything below that column is unchanged by which one was used.

**(a) The attribution reference — the default.** `recordClick` issues a public,
opaque, server-side reference (`attribution_tokens`, `ifx_…`) for a click that
produced an eligible attribution. The tracker keeps it in a first-party cookie,
exposes it as `window.Referral.attributionToken`, and appends it to Stripe
Payment Link hrefs by itself. The founder carries it through their checkout —
`client_reference_id` on a Checkout Session, `metadata[indicafluxo_ref]` on a
PaymentIntent or Subscription — and the webhook hands it back.
`src/server/services/attribution-bridge.ts` resolves it and binds. **No backend
code, no second deploy.** Full design: `INTEGRATION_ARCHITECTURE_V2.md`.

The reference is a correlation handle, not a credential: resolving one yields a
`visitor_id` inside one workspace and one environment and grants nothing else.
First bind wins — a second bind to a different customer is refused and recorded,
the same rule as the renewal lock in `tracking.ts`.

**(b) `POST /api/identify` — the advanced path.** Unchanged, still supported,
now optional. It is what a founder uses when the customer exists before the
checkout, when their flow carries no reference, or when they want their own user
id tied to the customer.

A click alone proves nothing. The SaaS customer's **server** calls:

```
POST /api/identify
Authorization: Bearer sk_live_…   (or sk_test_… for test programs)
{ visitorId, externalId, providerCustomerId?, email? }
```

- Authenticated by **secret key only** — never a public key, never a browser.
- `email` is hashed (`sha256(lower(trim(email)) + workspace pepper)`) before
  storage; the plaintext is never written.
- Creates/updates a `customers` row and stamps `attributions.customer_external_id`
  and `provider_customer_id`.

Trusting a `customerId` posted from a browser would let anyone reassign
commissions. That is why identify is server-to-server, full stop.

The key's environment decides everything identify touches: customers are
separate per environment, only attributions of programs in that environment are
bound, and a live key on a workspace without live mode answers
`402 LIVE_MODE_REQUIRED` (docs/PLANS.md §2). Re-identifying never clears a stored
provider customer id or e-mail hash.

Because Stripe orders nothing, a bind can arrive **after** the payment it
belongs to. `commissionsForBoundCustomer()` then walks that customer's payments
that carry no commission and runs the same
`commissionForTransaction()` the payment path runs — one implementation, in
`src/server/services/commission-writer.ts`, so both orderings produce the same
row. The bind itself never creates a `transactions` row, so it cannot duplicate
a payment.

### 3.3 Billing webhook → commission

```
Stripe → POST /api/webhooks/stripe/<integrationId>     (one endpoint per workspace)
   │  0. load the integration (service connection), decrypt its secrets (test and live)
   │  1. read raw body, verify the signature; event.livemode must match the secret that verified it
   │  1b. live event and no live mode → 200 "ignored", NOT claimed (re-sendable later)
   │  2. claim (scope customer_billing, provider, provider_event_id) in webhook_events
   │       ← idempotency gate; a previously FAILED event is re-claimed on Stripe's retry
   │       workspace_id = the integration's workspace — never event.account
   │  3. adapter.normalizeEvent() → NormalizedBillingEvent
   │  4. handleBillingEvent(workspaceId, event)
   │       ├ resolve customer: provider customer id, else identified e-mail hash
   │       ├ upsert customer / subscription
   │       ├ insert transaction (unique per provider id) + transaction_references
   │       ├ resolve attribution → program_affiliate
   │       ├ domain/commission.calculateCommission(...)   ← pure
   │       └ insert commission, or a proportional reversal on refund/dispute
   │  5. mark webhook_events row processed
   ▼  200 OK
```

Each workspace adds its own endpoints in its own Stripe dashboard — one in test
mode, one in live mode — so each has its own signing secret. The founder pastes
them in Integrations; they are
stored AES-256-GCM encrypted in `integrations.encrypted_credentials`
(`lib/crypto/secrets.ts`) and never shown again. An unknown integration or one
without a secret answers `404`; a bad signature `400 invalid_signature` (and
the time of the rejection is noted on the integration, so Integrations can say
"wrong secret").

`POST /api/webhooks/stripe` (no id) is the **legacy platform endpoint**: one
`STRIPE_WEBHOOK_SECRET`, workspace resolved from `event.account`. It remains for
Stripe Connect and for `stripe listen` in development. Both routes share
`ingestVerifiedWebhook` from step 2 on.

Step 2 is `claimWebhookEvent` (`server/repositories/webhook-events.ts`): an
insert that conflicts on `(scope, provider, provider_event_id)` and re-claims the
row only when its status is `failed`. A duplicate of a received/processed event
returns `200` immediately; a failed one is processed again when Stripe retries.
A refund that arrives before its payment fails on purpose (500) so the retry
finds the payment. Combined with `UNIQUE (workspace_id, provider,
provider_transaction_id)` on transactions, a duplicate delivery can never
produce a second commission.

One payment, several ids: a subscription invoice paid by a PaymentIntent can
arrive as `invoice.paid`, `payment_intent.succeeded` and `invoice_payment.paid`,
in any order. Each event takes an advisory lock on every id it knows, and
`transaction_references` points them at one transaction; if two transactions
were recorded before the link arrived, the later one is reversed in full with a
`dup_<id>` adjustment, so the net is always one commission.

Customers, transactions and attribution lookups stay inside the event's
environment (`livemode`); renewals keep crediting the affiliate who converted
the customer.

Steps 3–5 run inside one database transaction.

Refunds and disputes are recorded under their own ids (`re_…`, `dp_…`) and find
the payment through `transaction_references`, which maps every id of a payment
(`in_…`, `pi_…`, `ch_…`) to the id it was recorded under — filled by the payment
event and by `invoice_payment.paid`, in any order. Integrations shows health
from evidence, not from `integrations.status`: `server/services/integration-health.ts`
reads the latest event through `public.latest_webhook_event()` under
`withUser()` (`DATABASE.md` §6).

### 3.3b Every other billing provider (universal connectors)

`UNIVERSAL_ATTRIBUTION_ARCHITECTURE.md` is the design; this is the flow.

```
Mercado Pago / AbacatePay / Asaas → POST /api/webhooks/billing/<provider>/<connectionId>
   │  0. load the connection by id AND provider (service connection), decrypt its credentials
   │     unknown / other provider / disabled connector / no credentials → bare 404
   │  1. connector.verify(delivery, credentials)            ← before anything is trusted
   │       MP: HMAC of id+request-id+ts · AbacatePay: URL secret + body HMAC · Asaas: token header
   │  1b. MP only: learn the provider account (user_id) once; refuse another account
   │  2. environment: the connection's (key prefix) must match the event's → else TEST_LIVE_MISMATCH
   │  3. claim (customer_billing, provider, "<connectionId>:<event id>") — ids are scoped to the
   │     connection because no provider but Stripe documents globally unique event ids
   │  4. connector.normalize() → NormalizedBillingEvent[]   (async: MP fetches the payment)
   │  5. handleBillingEvent(workspaceId, event, …, { integrationId }) for each fact
   │  6. mark the claim with a reason code (src/lib/billing/reasons.ts)
   ▼  200 / 401 (unauthenticated) / 404 / 500 (retry) — never 410
```

Adapters (`src/lib/billing/<provider>/connector.ts`) implement `BillingConnector`
(`src/lib/billing/connector.ts`); what each can do is data in
`src/lib/billing/catalog.ts`. They are stateless: a provider that reports a
running refunded total sets `cumulativeRefundedMinor` and the core records the
delta. Connections are managed by `server/services/billing-connections.ts`
(connect → validate the key → register the webhook where the provider allows →
`connected`; disconnect keeps the ledger).

Customers resolve through `billing_identities` first (one customer, N provider
identities), then the legacy provider id on `customers`, then the SaaS's own id
carried in server-set checkout metadata (`externalCustomerId`), then the
e-mail rule. A reference token whose visitor was identified links the new
provider identity to that customer — which is how an attribution survives a
provider switch.

### 3.4 Payout

Payouts move no money. A batch belongs to one environment (a test batch pays
test commissions and nothing real is owed). `createPayoutBatch()` snapshots the
selected `available` commissions into `payout_items` and locks them by flipping
their status to `approved`. `markBatchPaid()` and `cancelPayoutBatch()` lock the
batch row, then its commissions:

- a commission reversed by a refund while its batch was open **stays
  `reversed` and is never paid**; each item's amount and the batch total are
  recomputed from what is still owed, an item with nothing left is cancelled,
  and the difference goes into the audit entry. A batch whose commissions were
  all reversed cannot be marked paid;
- cancelling returns only `approved` commissions to `available` — never a
  reversed one.

Reversing a paid batch is a new, explicit operation — never a delete (the app
role has no `DELETE` on batches or items, migration 0009).

---

## 4. Billing provider abstraction

```ts
interface BillingProvider {
  readonly id: BillingProviderId
  verifyWebhook(raw: string, signature: string): Promise<VerifiedWebhook>
  normalizeEvent(webhook: VerifiedWebhook): NormalizedBillingEvent | null
  getCustomer(accountId: string, customerId: string): Promise<ProviderCustomer | null>
  getSubscription(accountId: string, subId: string): Promise<ProviderSubscription | null>
  buildConnectUrl(params): string
  exchangeConnectCode(code: string): Promise<ProviderAccount>
}
```

`NormalizedBillingEvent` is a closed union — `payment.succeeded`,
`payment.refunded`, `payment.referenced` (ids of one payment, no money),
`subscription.updated`, `subscription.cancelled` — carrying
only primitives: ids, ISO strings, `amountMinor`, `currency`. No Stripe types
cross this line. Adding Paddle means adding one file under `lib/billing/paddle/`
and one entry in the registry; the commission engine does not change.

`verifyWebhook` on the adapter verifies with the platform secret (legacy
endpoint). Per-workspace endpoints call `verifyStripeWebhook(raw, signature,
secret)` from `lib/billing/stripe/webhook.ts` with the integration's own secret;
verification is local HMAC work and needs no Stripe API key.

We never hold a founder's Stripe **secret key**: an integration stores the
account id (`acct_…`) and the endpoint's **webhook signing secret**
(`whsec_…`), which only proves that deliveries came from that endpoint. It is
AES-256-GCM encrypted with `ENCRYPTION_KEY` in `integrations.encrypted_credentials`
as `{ webhookSecret }`, dropped on disconnect, and never returned to the browser.
Stripe Connect OAuth (`buildConnectUrl` / `exchangeConnectCode`) is wired to
"Connect with Stripe" when `STRIPE_CONNECT_CLIENT_ID` is set.

Every other provider is a `BillingConnector` (§3.3b): `verify` takes the raw
delivery (body, headers, query) because Mercado Pago signs `id + request-id +
ts`, AbacatePay adds a URL secret to a body HMAC and Asaas sends a token header
— one `signature` string cannot express those. `normalize` is async and plural.
A workspace may hold several connections of one provider
(`UNIQUE (workspace, provider, provider_account_id)`).

### Platform billing

Refvia charging workspaces for Launch/Growth is a second, separate Stripe
responsibility — see the table in `docs/PLANS.md` §5. It never shares code,
keys or tables with the founders' billing above.

```
Settings → startCheckoutAction / openBillingPortalAction   (features/billing/actions.ts)
   │  services/platform-billing.ts: requireMembership(admin) under withUser()
   │  PlatformBillingGateway (lib/platform-billing/stripe/gateway.ts) → Checkout / Billing Portal
   ▼  redirect to Stripe; the redirect back is not trusted

Stripe (Refvia's account) → POST /api/platform-billing/stripe/webhook
   │  1. verify with PLATFORM_STRIPE_WEBHOOK_SECRET, interpret (lib/platform-billing/stripe/normalize.ts)
   │  2. claimWebhookEvent(scope platform_billing)      ← a FAILED event is claimable again
   │  3. fetch the subscription from Stripe when the event only names it
   │  4. upsert workspace_subscriptions by workspace (service connection),
   │     never with an event older than provider_event_at
   ▼  200, or 500 so Stripe retries
```

`lib/platform-billing/stripe/` holds everything Stripe-shaped (client over
`PLATFORM_STRIPE_SECRET_KEY`, price ↔ plan mapping from `STRIPE_LAUNCH_PRICE_ID`
/ `STRIPE_GROWTH_PRICE_ID`, verification, a pure normaliser). The service sees
only `PlatformBillingEvent` and `PlatformBillingGateway`, which tests replace.
What a subscription row allows is `server/domain/entitlements.ts`.

---

## 5. Commission engine

```ts
calculateCommission(input: CommissionInput): CommissionOutcome
```

Pure. No DB, no clock (the current time is an input), no HTTP. It resolves, in
order: affiliate override → program rule; percentage (basis points) or fixed;
recurrence window (`commission_duration_months`, `null` = lifetime, `1` = first
payment only); rounding (half-up on minor units); hold period → `eligible_at`.
Refunds produce a **negative** reversal outcome referencing the original
commission. Every branch is covered in `src/server/domain/__tests__/`.

### Two clocks, and what each one governs

They are easy to conflate, and conflating them silently underpays affiliates.

| Clock | Field | Governs | Stops paying when |
| --- | --- | --- | --- |
| Attribution window | `attribution_window_days` | click → **conversion** | the visitor has not become a paying customer in time |
| Commission duration | `commission_duration_months` | conversion → **renewals** | the duration since the first commissioned payment has elapsed |

So `attribution.expires_at` is checked **only on the conversion** — the first
payment that earns a commission. Once a customer has converted, the affiliate is
locked to them and renewals are judged purely by the duration; otherwise a
60-day window would cancel a 12-month programme at month three. The recurrence
anchor is the *payment date* of the first commission, never the moment its row
was written, so a backfill cannot restart the clock.

---

## 6. Read models vs mutations

Analytics never hydrates entities. `server/repositories/analytics.ts` holds
purpose-built aggregate queries — `getDashboardOverview`, `getRevenueSeries`,
`getConversionFunnel`, `getTopAffiliates` — each returning exactly the columns a
view needs, aggregated in SQL. Loading a program's clicks into Node to draw a
chart is a defect, not a performance issue.

Lists are cursor/offset paginated with a hard `LIMIT`. There is no unbounded
`select()` in the codebase.

---

## 6b. Internationalisation

Two locales, `pt-br` (default) and `en`, configured in `src/i18n/routing.ts`.

**Every locale is prefixed, including the default.** `/pt-br/precos` and
`/en/pricing` both exist; `/precos` does not. An unprefixed default makes a
page's canonical URL depend on which locale it is in, which is what breaks
hreflang and sitemaps.

**Pathnames are translated, not merely prefixed.** `routing.ts` is the single
place a route's spelling lives. Components write canonical hrefs
(`/[workspaceSlug]/commissions`) and the navigation helpers resolve them.

| Instead of | Import from | Why |
| --- | --- | --- |
| `next/link` | `@/i18n/navigation` | a raw `Link` drops the locale prefix and 404s |
| `redirect`, `usePathname`, `useRouter` | `@/i18n/navigation` | same |
| a template-literal href | a typed `{ pathname, params }` object | the compiler cannot check a string |

That last row is enforced by types: `Link` accepts only canonical pathnames, so
`` href={`/${slug}/affiliates`} `` fails to compile. `TabLink` wraps the same
`Link`, so tab changes are typed client navigations that keep the scroll position.

**Formatting.** `lib/money.ts` is pure and takes a locale; `getFormatters()`
(server) and `useFormatters()` (client) bind it once per render. The ledger's
currency is a fact, not a preference: a commission recorded in USD stays USD for
a pt-BR reader, and only the formatting changes. Rendering it as `R$` would
invent an exchange rate nobody applied — asserted in `lib/__tests__/money.test.ts`.

**Catalogues** live in `src/i18n/messages/<locale>.json`. A missing key does not
crash — next-intl renders the key path — so parity, blank values and
copy-paste-without-translating are guarded in `src/i18n/__tests__/catalogues.test.ts`.

`app/api/**` and `/t.js` stay outside the locale segment: they have no reader.

---

## 7. Rendering

Server Components by default. `"use client"` only for genuine interactivity —
forms, dialogs, charts with hover, the theme toggle, the copy button — and it is
pushed to the leaf, never to a layout. Mutations are Server Actions in
`features/*/actions.ts`, which validate with Zod, authorize, call a service and
`revalidatePath`.

---

## 8. Security posture

- Every secret is server-only; the browser sees `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `NEXT_PUBLIC_APP_URL`, nothing else.
  See **Supabase security** below.
- API keys are stored as `sha256` hashes with a displayable prefix. The full
  secret is shown exactly once, at creation.
- Public endpoints (`/api/track`, `/api/identify`) are rate limited per key and
  per IP by an in-process token bucket (`lib/rate-limit.ts`) — swappable for a
  shared store without touching callers.
- Webhook signatures are verified before the payload is parsed as JSON.
- Security headers, including a CSP, are set in `next.config.ts`; `/t.js` is
  served with a long-lived, immutable cache and permissive CORS because it is by
  design a public asset.
- Structured logging (`lib/logger.ts`) carries `requestId`, `workspaceId`,
  `provider`, `eventId` — and redacts anything key-shaped.

### Supabase security

This project uses Supabase's current API-key model, not the legacy
`anon` / `service_role` JWTs.

| Key | Variable | Where it may appear |
| --- | --- | --- |
| `sb_publishable_*` | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser, edge middleware, server — always alongside the user's session |
| `sb_secret_*` | `SUPABASE_SECRET_KEY` | `lib/supabase/admin.ts` only |

- `sb_publishable_*` may be used in the browser.
- `sb_secret_*` is server-only.
- **No secret key may ever carry a `NEXT_PUBLIC_` prefix.** `NEXT_PUBLIC_*` is
  inlined into the client bundle at build time. `lib/env/client.ts` rejects a
  `sb_secret_*` value at parse time, and
  `lib/env/__tests__/no-secret-in-public-env.test.ts` guards it in CI.
- Normal operations respect RLS. Running on the server is not a reason to reach
  for the secret key: `lib/supabase/server.ts` uses the publishable key plus the
  request's auth cookies, so `auth.uid()` and every policy still apply.
- The admin client is for explicit administrative operations only. If an
  operation belongs to the signed-in user, fix the RLS policy — never bypass RLS
  for convenience.
- `DATABASE_URL` is a different mechanism entirely: direct Postgres for Drizzle,
  migrations and controlled scripts. It is not a Supabase API key.

## 9. Observability

`lib/logger.ts` emits single-line JSON in production, pretty output in dev, and
scrubs `authorization`, `sk_*`, `pk_*`, `whsec_*`, `token`, `secret`, `password`
at any depth. Webhook failures persist `error_message` on the `webhook_events`
row, so a failed delivery is debuggable from the database alone. Wiring Sentry
later means implementing one `onError` hook; nothing paid is required to run.

## 10. Public site: brand, SEO and acquisition

**Brand.** The product name is written once, in `src/lib/brand.ts`. Components
read `BRAND.name`; catalogues write `{brand}`, substituted in
`src/i18n/request.ts` before any message is formatted. Wire identifiers already
in customers' systems (`ifx_` tokens, the `indicafluxo_ref` metadata key,
tracker cookie names) deliberately do not follow a rename.

**Origins.** `appUrl()` is where the product runs (API, tracker, OAuth);
`siteUrl()` (`NEXT_PUBLIC_SITE_URL`, falling back to the app origin) is what
canonical URLs, hreflang, the sitemap and Open Graph use (`src/lib/site.ts`).

**Indexable registry.** `src/lib/seo/pages.ts` is the only list of indexable
pages. It feeds `app/sitemap.ts`, the proxy's public-route set and the SEO
tests. The root layout declares `noindex`; a page becomes indexable only by
being registered and building its metadata with `pageMetadata()`
(`src/lib/seo/metadata.ts`: title, description, self-canonical, `pt-BR`/`en`/
`x-default` alternates, robots, Open Graph, Twitter). The whole site stays
`noindex` with a closed robots.txt unless `SITE_INDEXING=on` at build time.

**Structured data** (`src/lib/seo/structured-data.ts`, rendered by
`components/seo/json-ld.tsx`): Organization, WebSite and SoftwareApplication
(offers = `PLAN_OFFERS`) on the home page; BreadcrumbList on inner pages. No
ratings, reviews or FAQPage.

**Search-intent pages** are one Server Component
(`features/marketing/content-page.tsx`) driven by a section map
(`content-pages.ts`) and the `seo.pages.*` catalogue. Adding one: a pathname in
`routing.ts`, an entry in `pages.ts`, a section map, copy in both catalogues,
a `page.tsx` + `opengraph-image.tsx`, a row in SEO_CONTENT_MAP.md.

**Acquisition.** On a public document request with no `_acq` cookie, the proxy
records the first touch (channel from UTM / ad click id / referring host,
landing path, locale) — `src/lib/seo/acquisition.ts`. `createWorkspaceAction`
stores it on `workspaces.acquisition` and deletes the cookie. `pnpm seo:funnel`
joins it to milestones the database already records (program, sandbox
commission, real click, live commission, paid plan). No client-side analytics
script is involved.
