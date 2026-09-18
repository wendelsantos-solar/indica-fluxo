# INTEGRATION_ARCHITECTURE_V2.md

The integration architecture after the rework. Phase 1 design; read
`INTEGRATION_ARCHITECTURE_AUDIT.md` first — it holds the evidence every decision
here rests on, including the verified Stripe findings.

**The one rule this design serves:** the founder should have to understand their
affiliate, their checkout and their payment. Everything between those three
belongs to IndicaFluxo.

---

## 1. Domain model

```
ReferralClick ──┐
                ├─→ Attribution ──→ AttributionToken  (public, opaque, scoped)
programs, rules ┘        │                  │
                         │                  │  travels: site → checkout → Stripe → webhook
                         ▼                  ▼
                      Customer ◄──── bindAttributionToken()
                         │                    (or /api/identify, unchanged)
                         ▼
                 billing identity = (provider, provider_customer_id) on the customer row
                         │
                         ▼
                 NormalizedBillingEvent  ← the only thing the domain sees
                         │
                         ▼
                   Transaction ──→ calculateCommission() ──→ Commission
```

`calculateCommission` does not change, is not called with anything new, and
still knows nothing about Stripe, checkouts, links or tokens. The whole rework
lands **above** it.

### What is new

| Concept | Shape | Why it exists |
| --- | --- | --- |
| **AttributionToken** | `ifx_` + 43 base64url chars, stored as a salted hash | the only value safe to hand to a payment provider that still means "this session has an eligible attribution" |
| **Attribution bridge** | `src/server/services/attribution-bridge.ts` | one place that turns a token + a provider customer id into a bound attribution, whatever checkout produced it |
| **`attribution.bind` event** | a `NormalizedBillingEvent` variant carrying no money | `checkout.session.completed` says who the customer is and carries the reference, but is not itself a payment |
| **`attributionToken` on payment events** | optional field on the existing variants | Elements / PaymentIntent / Subscription API carry it in `metadata` |
| **Commission backfill** | `commissionsForBoundCustomer()` | Stripe does not order events; a bind that arrives after the payment must still produce the commission |

### What is deliberately NOT new

- **No `billing_identities` table.** Audit §4.1: only Stripe is integrated, so
  the table would hold exactly one row per customer — CLAUDE.md rule 10. The
  migration path is recorded in the audit and stays a pure `INSERT … SELECT`.
  What this phase owes the future is respected instead: the bridge resolves a
  **customer** and treats `(provider, providerCustomerId)` as an input, never as
  a property other code reads back.
- **No `checkout_sessions` table.** A checkout is an event, not an entity
  (the prompt's §3 is right and the code already agrees).
- **No new adapter per checkout method.** One `StripeBillingProvider`; the
  checkout method only decides *where the token was found* in the payload.

## 2. AttributionToken

### Format

```
ifx_<43 chars of base64url>            e.g. ifx_qN7dR2mK9xP4wL0vH6sT8yB3cF5gJ1aZ...
```

- 32 random bytes from `crypto.randomBytes` → base64url. Alphabet is
  `A-Za-z0-9-_`, which is exactly what **Payment Links accept** and well inside
  the 200-character limit of `client_reference_id` and the 500-character limit
  of a metadata value (audit §5).
- Stored as `sha256(token + HASH_PEPPER)` in `token_hash`, plus a displayable
  `token_prefix` (`ifx_qN7dR2` — 6 chars) for diagnostics. **The plaintext is
  never stored**, exactly like `api_keys`.

### Lifecycle

| Moment | What happens |
| --- | --- |
| **Issued** | inside `recordClick()`, in the same transaction, only when the click actually produced or touched an attribution (`attributionAction !== "ignore"`). A visitor with no eligible attribution never gets a token |
| **Reused** | the tracker sends the token it already holds; if it is still valid for this workspace + environment + visitor, it is kept and its expiry extended to the new window |
| **Transported** | cookie `_referral_ref` on the founder's domain, `window.Referral.attributionToken`, and automatically appended to Payment Link `<a>` hrefs by the tracker |
| **Resolved** | server-side only, by hash, scoped to workspace + environment |
| **Bound** | first bind wins. `bound_provider_customer_id` is written once |
| **Expired** | `expires_at` = the attribution window of the program that issued it. An expired token resolves to nothing |

### Security (§41, §42)

| Property | How |
| --- | --- |
| entropy | 256 bits |
| not enumerable | random, and only ever looked up by hash |
| no privilege | resolving a token yields a `visitor_id` **inside one workspace and one environment**. It grants no read of any customer, affiliate, program or amount |
| no tampering | any modification produces an unknown hash → resolves to nothing → the payment is simply unattributed |
| no replay onto another customer | `bound_provider_customer_id` is written on first bind; a second bind with a different `cus_` is refused and recorded as `token_conflict` — the same rule as the existing renewal lock in `tracking.ts` |
| no forgery into commission | a token is only ever issued by IndicaFluxo after a real click on an **approved** participation. Inventing one earns nothing |
| environment isolation | the row carries `environment`; a live event never resolves a test token |

`visitorId` keeps its role (browser identity, first-party cookie, internal) and
is never sent to a payment provider. The two values are separate on purpose
(audit §4.2).

## 3. Resolution precedence

One deterministic order, applied by `billing-events.ts`:

```
1. attributionToken on the event        → bridge binds provider_customer_id onto
                                          this visitor's open attributions
2. customers row by (workspace, environment, provider, provider_customer_id)
3. attributions.provider_customer_id    (bound by 1, by identify, or by 5)
4. attributions.customer_external_id    (bound by /api/identify)
5. customers by e-mail hash             — only when exactly one identified
                                          customer matches; ambiguity matches
                                          nothing (unchanged rule)
6. no match                             → transaction recorded, no commission,
                                          diagnosed as expected or suspicious
```

Steps 2–6 are today's behaviour, unchanged. Step 1 is the new one and runs
first because it is the only one backed by an explicit, server-issued reference.

## 4. Checkout strategies

One provider, five transports. None of them adds domain logic.

| Strategy | Founder writes | Token read from | Event that binds |
| --- | --- | --- | --- |
| **A · Stripe Checkout** | `client_reference_id: ifx_…` on session creation | `session.client_reference_id`, else `session.metadata.indicafluxo_ref` | `checkout.session.completed` |
| **B · Payment Links** | *nothing* — the tracker appends `?client_reference_id=` to `buy.stripe.com` links on the page | same | `checkout.session.completed` |
| **C · Elements / PaymentIntent** | `metadata[indicafluxo_ref]` on the PaymentIntent | `payment_intent.metadata` | `payment_intent.succeeded` |
| **D · Subscription API** | `metadata[indicafluxo_ref]` on the Subscription (once, at creation) | `subscription.metadata`, and `invoice.metadata` / `invoice.parent.subscription_details.metadata` | `customer.subscription.created`, `invoice.paid` |
| **E · Advanced** | `POST /api/identify` | — | unchanged |

Renewals carry nothing: once the bind is made the customer row holds the Stripe
id and every later invoice resolves through step 2 (§15 of the brief).

`checkout.session.completed` is added to the handled-event list. It **never
creates a transaction** — the invoice or PaymentIntent event does that — so it
cannot introduce a duplicate.

## 5. Idempotency and ordering

The existing machinery stays the source of truth: `webhook_events` UNIQUE
(scope, provider, event id), `transactions` UNIQUE (workspace, provider,
provider id), `transaction_references` + per-payment advisory locks, and
`commissions` UNIQUE (transaction_id, program_affiliate_id) where the row is not
a reversal.

Two orderings must both work, because Stripe guarantees neither:

```
bind first            checkout.session.completed → invoice.paid
                      bind writes the attribution; the payment then resolves
                      through the normal path. No backfill needed.

payment first         invoice.paid → checkout.session.completed
                      the payment is recorded with no commission; the bind then
                      calls commissionsForBoundCustomer(), which walks the
                      customer's payment transactions that have no commission
                      and runs the same createCommissionForTransaction() the
                      payment path uses.
```

The backfill is idempotent by construction: it inserts through the same unique
index, with `onConflictDoNothing`, inside the same transaction, and it never
creates or modifies a `transactions` row.

To keep both paths honest, the commission-creation half of `recordPayment()` is
extracted into `createCommissionForTransaction()` and called from both. There is
exactly one implementation of "a recorded payment becomes a commission".

## 6. Stripe connection

Two supported ways to connect, with the manual one unchanged and still the
default.

### Manual (today, unchanged)

`acct_…` + an endpoint the founder creates in their Stripe dashboard + the
`whsec_…`. Kept because it needs nothing from IndicaFluxo's Stripe account, and
because every existing integration uses it.

### OAuth (new, when `STRIPE_CONNECT_CLIENT_ID` is configured)

```
[ Conectar com Stripe ]
   → connect.stripe.com/oauth/authorize?client_id=…&scope=read_only&state=<signed>
   → founder authorises in their own Stripe account
   → /api/integrations/stripe/oauth/callback?code=…&state=…
   → POST connect.stripe.com/oauth/token  → { stripe_user_id: "acct_…" }
   → integrations row: provider_account_id, status connected, metadata.connection = "oauth"
```

Events then arrive at the **platform Connect endpoint** that already exists —
`/api/webhooks/stripe`, verified with `STRIPE_WEBHOOK_SECRET` and routed by
`event.account` through `workspaceForProviderAccount()`. The founder creates no
endpoint, selects no events and copies no secret.

Why OAuth and not the alternatives (audit §5):

- `scope=read_only` — IndicaFluxo reads events. It never charges, transfers,
  pays out or holds funds on the account. No KYC, no custody, no Connect
  liability, and nothing in the product's "we never touch the money" rule is
  weakened.
- Creating each endpoint through `POST /v1/webhook_endpoints` would require the
  founder's **secret API key** — strictly worse than a signing secret.
- A Stripe App means a marketplace listing and a review cycle. Disproportionate
  today; the right move later, for distribution rather than for friction.

Requirements this puts on IndicaFluxo: Connect enabled on the platform Stripe
account, OAuth onboarding switched on, a redirect URI registered, and a Connect
webhook endpoint (`connect: true`). Without `STRIPE_CONNECT_CLIENT_ID` the
button is not rendered and nothing changes.

CSRF: `state` is `HMAC-SHA256(workspaceId | nonce | expiry, ENCRYPTION_KEY)`
carried with the nonce in an `HttpOnly`, `SameSite=Lax`, 10-minute cookie, and
both are checked on the callback.

## 7. Database

One new table. No existing row is rewritten.

```sql
attribution_tokens
  id                          uuid pk
  workspace_id                uuid not null → workspaces on delete cascade
  environment                 environment not null
  visitor_id                  text not null
  token_hash                  text not null           -- sha256(token + HASH_PEPPER)
  token_prefix                text not null           -- 'ifx_qN7dR2', displayable
  issued_at                   timestamptz not null default now()
  expires_at                  timestamptz not null
  bound_provider_customer_id  text
  bound_at                    timestamptz
  created_at / updated_at

UNIQUE (token_hash)
INDEX  (workspace_id, environment, visitor_id)        -- reuse on the next click
INDEX  (workspace_id, issued_at desc)                 -- diagnostics list
```

- **RLS**: enabled. `SELECT` for workspace members (`is_workspace_member`), no
  client write path at all; `anon` and `authenticated` hold no privileges
  (migration 0009 model), `indica_app` gets `SELECT`. Writes happen on the
  service connection inside the ingest paths, like `referral_clicks`.
- **Indexes**: three, each backing a query that exists. No preventive ones.
- **Not keyed by integration**, so a future second Stripe account per workspace
  needs no migration (audit §4.4).
- **Rollback**: `DROP TABLE attribution_tokens` restores the previous state
  exactly — nothing else references it, and every pre-existing flow works
  without it.

## 8. Backward compatibility

| Contract | Status |
| --- | --- |
| `POST /api/identify` request, response, error codes | **unchanged** |
| `POST /api/track` request | **additive** — optional `token` field |
| `POST /api/track` response | **additive** — `token` added |
| `/t.js` `window.Referral.visitorId`, `_referral_id` cookie | **unchanged** |
| per-workspace webhook endpoint + `whsec_` | **unchanged** |
| `NormalizedBillingEvent` | **additive** — one new variant, one optional field |
| `calculateCommission` | **unchanged** |
| existing integrations | keep working with no action from the founder |

No breaking change. A founder who does nothing keeps the behaviour they have.

## 9. Diagnostics

The architecture's second job is that a broken integration says so.

- `attribution.bind` outcomes are named, not silent: `bound`, `already_bound`,
  `token_unknown`, `token_expired`, `token_conflict`, `no_customer`.
- A payment with no attribution is still a **normal outcome** (an organic
  customer). It is separated from a suspicious one: a payment that arrives in a
  workspace where a token was issued for that checkout but did not resolve is
  `POSSIBLE_INTEGRATION_PROBLEM`; everything else is `EXPECTED_UNATTRIBUTED`.
- `webhook_payments_without_customer` (migration 0015) already counts the
  payments Stripe delivered with no customer at all.

## 10. UX flow

```
BEFORE                                   AFTER
create account                           create account
create workspace                         create workspace
create program                           create program
invite + approve affiliate               invite + approve affiliate
install tracker            ← a deploy    SIMULATE  → 🎉 first commission  (aha, no code)
write identify call        ← a deploy    install tracker                   ← one deploy
create Stripe endpoint                   choose how you charge (multi-select)
select 10 events                         add one reference to your checkout
paste whsec_                             connect Stripe (one click, when OAuth is on)
hope                                     verify — the product tells you it worked
```

The activation checklist reorders to put the simulated conversion **before**
the technical work: it is the only step that proves the product without a
deploy, and it already runs through the real services
(`src/server/services/sandbox.ts`).
