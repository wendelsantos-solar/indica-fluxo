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
| `import Stripe` anywhere outside `lib/billing/stripe/` | locks us to one provider |
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
   (provider-authenticated writes), and `server/db/seed` (development only).
   Everything else goes through `withUser()` / `withAnon()`, which downgrade to
   the `authenticated` / `anon` role so Postgres policies stay the boundary.
2. **The Supabase admin client** (`SUPABASE_SECRET_KEY`, `lib/supabase/admin.ts`).
   Reserved for administrative Supabase API calls that have no user session at
   all (Auth Admin operations, maintenance scripts). Its only call site is
   `server/db/seed/auth.ts`, which provisions demo logins; adding another
   requires a comment stating why the operation cannot run under RLS.

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
       POST /api/track   { publicKey, ref, url, referrer, utm* }
            │  Zod parse · public-key lookup · origin check · rate limit
            ▼
       TrackingService.recordClick()
            │  resolve program_affiliate by (program, code)
            │  insert referral_clicks
            │  upsert attribution  ← domain/attribution (pure)
            ▼
       Set-Cookie _referral_id (first-party, HttpOnly=false, SameSite=Lax, 1y)
```

The tracker is plain TypeScript compiled to a standalone script served from
`/t.js`. It knows nothing about React. `/api/track` contains no business logic,
so the whole endpoint can be lifted to an edge worker later without touching
`server/domain/attribution.ts`.

### 3.2 Binding a visitor to a customer (identify)

A click alone proves nothing. The SaaS customer's **server** calls:

```
POST /api/identify
Authorization: Bearer sk_live_…
{ visitorId, externalId, providerCustomerId?, email? }
```

- Authenticated by **secret key only** — never a public key, never a browser.
- `email` is hashed (`sha256(lower(trim(email)) + workspace pepper)`) before
  storage; the plaintext is never written.
- Creates/updates a `customers` row and stamps `attributions.customer_external_id`
  and `provider_customer_id`, which is how the webhook later finds the affiliate.

Trusting a `customerId` posted from a browser would let anyone reassign
commissions. That is why identify is server-to-server, full stop.

### 3.3 Billing webhook → commission

```
Stripe → POST /api/webhooks/stripe
   │  1. read raw body, verify signature (lib/billing/stripe)
   │  2. claim (provider, provider_event_id) in webhook_events  ← idempotency gate
   │  3. adapter.normalizeEvent() → NormalizedBillingEvent
   │  4. BillingEventService.handle(event)
   │       ├ upsert customer / subscription
   │       ├ insert transaction (unique per provider id)
   │       ├ resolve attribution → program_affiliate
   │       ├ domain/commission.calculateCommission(...)   ← pure
   │       └ insert commission (or reversal on refund)
   │  5. mark webhook_events row processed
   ▼  200 OK
```

Step 2 is an `INSERT … ON CONFLICT DO NOTHING RETURNING id`. If nothing comes
back, the event was already claimed and we return `200` immediately. Combined
with `UNIQUE (workspace_id, provider, provider_transaction_id)` on transactions,
a duplicate delivery can never produce a second commission.

Steps 3–5 run inside one database transaction.

### 3.4 Payout

Payouts move no money. `PayoutService.createBatch()` snapshots the selected
`available`/`approved` commissions into `payout_items`, locks them by flipping
their status, and `markPaid()` stamps `paid_at` on both the batch and the
commissions, writing an audit log entry. Reversing a paid batch is a new,
explicit operation — never a delete.

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
`payment.refunded`, `subscription.updated`, `subscription.cancelled` — carrying
only primitives: ids, ISO strings, `amountMinor`, `currency`. No Stripe types
cross this line. Adding Paddle means adding one file under `lib/billing/paddle/`
and one entry in the registry; the commission engine does not change.

Stripe is connected via **Stripe Connect OAuth**, so we hold an account id, not
the customer's secret key. `integrations.encrypted_credentials` exists for
providers that force us to hold a token, and is AES-256-GCM encrypted with
`ENCRYPTION_KEY` (`lib/crypto/secrets.ts`).

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
