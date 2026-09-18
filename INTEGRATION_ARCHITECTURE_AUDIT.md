# INTEGRATION_ARCHITECTURE_AUDIT.md

Phase 0 of the integration architecture rework. What exists today, where the
friction is, and what the current Stripe API actually allows. Written before any
code changed; no conclusion here is taken from a prompt, a comment or a README —
each one names the file that proves it.

Date: 2026-09-18 · SDK `stripe@22.6.2`, pinned API version `2026-08-26.dahlia`.

---

## 1. Current flow

```
affiliate link  ?ref=CODE
      │
      ▼
/t.js  (tracker)                 src/app/t.js/route.ts, src/lib/tracking/script.ts
      │  reads code, mints visitorId v_…, writes cookie _referral_id (365d)
      ▼
POST /api/track  (pk_…)          src/app/api/track/route.ts
      │  → recordClick()                     src/server/services/tracking.ts
      │  → referral_clicks row
      │  → resolveAttribution()              src/server/domain/attribution.ts
      ▼
attributions (program_id, visitor_id)   UNIQUE — one live attribution per pair
      │  customer_external_id = NULL
      │  provider_customer_id = NULL          ← the gap the whole rework closes
      │
      │  ┌──────────────── the founder must write code here ────────────────┐
      ▼  │ POST /api/identify  (sk_…)          src/server/services/identify.ts │
attributions.customer_external_id = externalId                                 │
attributions.provider_customer_id = cus_…                                      │
customers row (workspace, environment, provider, provider_customer_id)         │
      │  └──────────────────────────────────────────────────────────────────┘
      ▼
Stripe webhook  /api/webhooks/stripe/[integrationId]   (per-workspace whsec_)
      │  verify → claim webhook_events → StripeAdapter.normalizeEvent()
      ▼
handleBillingEvent()                    src/server/services/billing-events.ts
      │  resolveCustomer()   by provider_customer_id, else by email hash
      │  findAttribution()   by attributions.provider_customer_id
      │                       or attributions.customer_external_id
      ▼
transactions  →  calculateCommission()   src/server/domain/commission.ts
      ▼
commissions
```

Everything below the attribution row is sound and stays. The rework is entirely
about **how `attributions.provider_customer_id` gets written**.

## 2. Current friction

Ten steps, measured against the product's own integration guide and code:

| # | Step | Where | Cost |
| --- | --- | --- | --- |
| 1 | create program, pick model / window / hold | Programs → New | 4 decisions the founder has never made before |
| 2 | invite **and approve** an affiliate | Affiliates | silent trap: only `approved` participations earn |
| 3 | generate `pk_test_` / `sk_test_` | Integrations | shown once |
| 4 | paste `/t.js` before `</head>` | founder's site | **a deploy** |
| 5 | read the `_referral_id` cookie server-side | founder's backend | code |
| 6 | call `POST /api/identify` after sign-up | founder's backend | **code + a second deploy** |
| 7 | call it again when the Stripe customer exists | founder's backend | more code |
| 8 | enter `acct_…` | Integrations | dashboard hunt |
| 9 | create the endpoint in Stripe, **select 10 events**, choose Snapshot payload | Stripe dashboard | the most error-prone step |
| 10 | paste `whsec_…` | Integrations | shown once by Stripe |

Steps 5–7 and 8–10 are the two blocks worth removing. Steps 5–7 are the only
ones that require the founder to **write and deploy code**, and no competitor
requires them.

`/api/identify` is unavoidable today because it is the **only** writer of
`attributions.customer_external_id` / `provider_customer_id`
(`src/server/services/identify.ts:158-186`). Without it a payment reaches
`findAttribution()` with nothing to match on and is recorded as
`"payment recorded without attribution"` — silently, with HTTP 200 to Stripe.

## 3. Existing data model

### `attributions` — `src/server/db/schema/tracking.ts`

```
UNIQUE (program_id, visitor_id)
program_affiliate_id, first_click_id, last_click_id, attribution_model
customer_external_id  (text, null)   ← written only by identify
provider_customer_id  (text, null)   ← written only by identify / email backfill
attributed_at, expires_at
```

The visitor is the key. A binding is a pair of nullable text columns on the
attribution row. **No table is keyed by anything a checkout could carry.**

### `customers` — `src/server/db/schema/billing.ts`

```
UNIQUE (workspace_id, environment, provider, provider_customer_id) where not null
UNIQUE (workspace_id, environment, external_id)                    where not null
provider, provider_customer_id, external_id, email_hash, program_id
```

A customer row **is** its billing identity: one `provider` + one
`provider_customer_id` per row. One internal customer therefore cannot hold two
provider identities today.

### `integrations` — `src/server/db/schema/platform.ts`

```
UNIQUE (workspace_id, provider)        ← one Stripe account per workspace
provider_account_id, encrypted_credentials (AES-256-GCM whsec_), status, metadata
```

### Idempotency

- `webhook_events` UNIQUE (scope, provider, provider_event_id)
- `transactions` UNIQUE (workspace, provider, provider_transaction_id)
- `transaction_references` maps `pi_`/`ch_`/`in_` → the id a payment is recorded
  under, plus per-payment advisory locks. This is the machinery that makes
  `invoice.paid` + `payment_intent.succeeded` produce one commission.

## 4. Audit answers to the questions this rework asks

### 4.1 Does the current model already support Billing Identity? — **No, but it does not block it**

`customers` carries exactly one identity. A second provider for the same human
would need a second `customers` row, and the ledger (`transactions.customer_id`,
`commissions.customer_id`, `subscriptions.customer_id`) hangs off that row.

Migrating later is mechanical: `billing_identities` would be created and
back-filled 1:1 from `customers.(provider, provider_customer_id)`, which is a
pure `INSERT … SELECT`. Nothing in the present schema makes that harder later
than it is now.

**Decision: (B) evolve, do not create the table in this phase.** Only Stripe is
integrated (`src/lib/billing/provider.ts` registers one adapter), so a
`billing_identities` table today would be an empty abstraction with exactly one
row per customer — CLAUDE.md rule 10. What this phase *does* owe the future is
that nothing new assumes "one customer = one provider id": the resolver is
written against a **customer**, and the provider id is an input to it, not a
property the rest of the code reads.

### 4.2 Can `visitorId` be the public reference? — **No**

| Requirement (§8, §41, §42) | `visitorId` |
| --- | --- |
| opaque | yes |
| unguessable | yes (16–48 random chars) |
| **issued and validated server-side** | **no — minted in the browser by `/t.js`, never registered** |
| proves an eligible attribution exists | **no — any string is a "valid" visitorId** |
| scoped to workspace + environment | **no — it is global and unscoped** |
| revocable / expiring | **no** |
| safe to hand to a third party (Stripe, founder logs, URLs) | **no — it is the cookie value; leaking it leaks the visitor's tracking identity** |

A browser-minted identifier travelling through a payment provider's dashboard,
a Payment Link URL and the founder's logs is the wrong object. The two roles
separate cleanly:

- `visitorId` — technical identity of the browser. Stays in the first-party
  cookie, stays internal.
- `attributionToken` — public, server-issued, scoped, expiring handle that means
  *"this session has an eligible attribution"*. Safe to put in a URL.

### 4.3 Do we need a new table for the token? — **Yes, one**

Nothing existing can hold it: `attributions` is per (program, visitor) and a
visitor may have attributions in several programs at once; `referral_clicks` is
append-only and high-volume. A token is one row per issued handle, looked up by
hash. There is no cheaper place to put it.

### 4.4 Can a workspace have several Stripe accounts? — **Not today**

`integrations` is UNIQUE (workspace_id, provider). Nothing else blocks it:
`webhook_events`, `transactions` and `customers` are keyed by workspace +
environment + provider id, and Stripe ids are globally unique per object type,
so two accounts cannot collide. The new token table must therefore **not** be
keyed by integration; keyed by workspace + environment, it survives a future
second account without a migration.

## 5. Stripe documentation findings (verified 2026-09-18)

| Finding | Consequence |
| --- | --- |
| `client_reference_id` on a Checkout Session: "a unique string to reference the Checkout Session… used to reconcile the Session with your internal systems". Present on the object in **every** mode (`payment`, `subscription`, `setup`). | Strategy A: one field, no metadata gymnastics |
| Payment Links accept `?client_reference_id=` in the URL: **alphanumeric, `-` and `_` only, up to 200 characters**; invalid values are *silently dropped* | Strategy B works, and the token alphabet **must** be `[A-Za-z0-9_-]`. base64url qualifies; base64 and hex-with-colons do not |
| Checkout Session `metadata` does **not** propagate to the PaymentIntent or Subscription. `payment_intent_data.metadata` and `subscription_data.metadata` are the explicit paths | Do not read session metadata on payment events. Bind on `checkout.session.completed` itself |
| `metadata` limits: 50 keys, key ≤ 40 chars, value ≤ 500 chars, any characters except `[` `]` in keys | `indicafluxo_ref` (15 chars) and a ~47-char token fit with room to spare |
| The Checkout Session object carries `customer` (set in `subscription` mode, and in `payment` mode with `customer_creation: always`), `livemode`, `mode`, `payment_status`, `subscription`, `payment_intent` | `checkout.session.completed` has everything binding needs, and nothing that requires an API call |
| Connect: a webhook endpoint created with `connect: true` "notifies the specified URL about events from **all** connected accounts"; each event carries a top-level `account` | One platform endpoint replaces every founder's manual endpoint. **The route already exists** — `src/app/api/webhooks/stripe/route.ts` routes by `event.account` through `workspaceForProviderAccount()` |
| OAuth for Standard accounts: still documented and functional. Stripe says it "isn't recommended for new Connect platforms" and points new *marketplaces* at Connect Onboarding — but explicitly exempts **Extensions**: "Extensions won't experience any changes to how OAuth behaves" | IndicaFluxo is an extension (reads an existing account, never charges on its behalf). OAuth `read_only` is the documented path for exactly this case |
| OAuth returns `stripe_user_id` (the `acct_…`) from the token endpoint; `scope=read_only` is the default; `account.application.deauthorized` fires on disconnect; test and live have separate `client_id`s | `STRIPE_CONNECT_CLIENT_ID` already exists in `.env.example` and `src/lib/env/server.ts` |

### What this rules out

- **Creating each founder's webhook endpoint via `POST /v1/webhook_endpoints`**
  would need their secret API key. Asking for a secret API key is *more*
  dangerous and not obviously less work than pasting a `whsec_`. Rejected.
- **Stripe Apps** would put IndicaFluxo in Stripe's marketplace with a review
  cycle and a UI surface inside the Stripe dashboard. Disproportionate for one
  connect button. Rejected for now, revisit for distribution.
- **Connect with `read_write`, charges or payouts on behalf** — out of scope by
  the product's own rule: IndicaFluxo never touches money. `read_only` it is.

## 6. Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| A token in a Payment Link URL is shareable: a customer forwards the link, a second person buys, the commission goes to the first person's affiliate | medium | Same exposure as every referral cookie in the market. Token expires with the attribution window; one token binds one provider customer (§ token reuse below) |
| Token replay: the same token used later with a *different* Stripe customer to move attribution | medium | First bind wins. A second bind with a different `cus_` is refused and recorded as a diagnostic, mirroring the existing renewal lock in `tracking.ts` |
| Forged token | low | Tokens are issued by IndicaFluxo and looked up by hash; an unknown token resolves to nothing and the payment is simply unattributed |
| Cross-environment leak | high if wrong | The token row carries `environment`; a live event never resolves a test token and vice versa. Same rule as `api_keys` |
| `checkout.session.completed` arriving **after** `invoice.paid` | high | Binding must be retro-active: after binding, re-check payments already recorded for that customer without a commission. Otherwise the first payment silently earns nothing |
| Connect OAuth requires enabling Connect on the platform Stripe account | medium | Manual setup stays supported and is the default when `STRIPE_CONNECT_CLIENT_ID` is unset. Nothing breaks for existing integrations |
| A second commission created by the retro-active bind | **critical** | The bind path must reuse the existing advisory-lock + `transaction_references` machinery and must never create a transaction |

## 7. Migration constraints

1. `/api/identify` is a **public contract**. It keeps its request shape, its
   response shape (`ok`, `customerId`, `attributionsBound`) and its error codes.
   It becomes optional, never removed.
2. `attributions.customer_external_id` stays the identify-written column. The
   token path writes `provider_customer_id` only — a Stripe customer has no
   `externalId` in the founder's system and inventing one would collide with the
   `customers` unique key on `external_id`.
3. Existing integrations keep working untouched: per-workspace endpoint, own
   `whsec_`, manual event selection.
4. No existing row is rewritten by the migration. The new table starts empty.
5. RLS: the new table is tenant data and gets the same treatment as
   `referral_clicks` — written by the service connection on the anonymous ingest
   path, readable by the workspace, never by `anon` or `authenticated` through
   the Data API (migration 0009 role model).
