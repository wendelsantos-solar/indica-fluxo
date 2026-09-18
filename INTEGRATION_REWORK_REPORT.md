# INTEGRATION_REWORK_REPORT.md

What changed, what it costs the founder now, and what was deliberately left
undone. Phase 0 is `INTEGRATION_ARCHITECTURE_AUDIT.md`, phase 1 is
`INTEGRATION_ARCHITECTURE_V2.md`; this is the account of the implementation.

Date: 2026-09-18 · `stripe@22.6.2`, API `2026-08-26.dahlia`.

```
CHECKOUT_COUPLING=LOW
IDENTIFY_REQUIRED_FOR_STRIPE_CHECKOUT=false
MANUAL_WEBHOOK_SETUP_REQUIRED=false   (with STRIPE_CONNECT_CLIENT_ID; true without it — manual stays supported)
MULTIPLE_CHECKOUT_METHODS_SUPPORTED=true
MULTIPLE_BILLING_IDENTITIES_SUPPORTED=false   (one identity per customer row; migration path documented, deliberately not built)
FUTURE_PROVIDER_READY=true
```

---

## 1. Previous architecture

A referral only became money if the founder's **backend** wrote the link:

```
click → /api/track → attributions(program, visitor)
                            ↓  customer_external_id = NULL
                            ↓  provider_customer_id = NULL
            POST /api/identify  ←── the founder's server, the only writer
                            ↓
Stripe webhook → resolveCustomer → findAttribution → transaction → commission
```

`/api/identify` was the single writer of `attributions.provider_customer_id`
(`src/server/services/identify.ts`). Without it, a payment reached
`findAttribution()` with nothing to match on and was recorded as *"payment
recorded without attribution"* — silently, answering Stripe `200`.

## 2. New architecture

```
click → /api/track ──→ attribution  ──→ AttributionToken  (ifx_…, server-issued, opaque)
                                              │
     tracker cookie · window.Referral.attributionToken · auto-appended to Payment Links
                                              │
        Stripe Checkout  │  Payment Links  │  Elements/PaymentIntent  │  Subscriptions API
        client_reference_id                 metadata[indicafluxo_ref]
                                              │
                        webhook → StripeAdapter.normalizeEvent()
                                              │
                    attribution-bridge: bindAttributionToken()
                                              │
              attributions.provider_customer_id  ← the same column as before
                                              │
                    commission-writer → calculateCommission()
```

The domain did not move. `calculateCommission` is untouched, is called with
nothing new, and still knows nothing about Stripe, checkouts, links or tokens.
The whole rework lands above `transactions`.

**New modules**

| Module | Job |
| --- | --- |
| `src/lib/tracking/attribution-token.ts` | the token's format, alphabet and recognition. Crypto-free, shared by tracker, adapter, docs and tests |
| `src/server/services/attribution-bridge.ts` | issue, resolve, bind, and backfill commissions for a late bind |
| `src/server/services/commission-writer.ts` | the one implementation of "a recorded payment becomes a commission" |
| `src/server/services/stripe-connect.ts` | OAuth state, authorize URL, account exchange |
| `src/app/api/integrations/stripe/oauth/{route,callback/route}.ts` | the two halves of "Connect with Stripe" |

## 3. Tables changed

**One new table, no existing row rewritten, no column dropped.**

`attribution_tokens` — `workspace_id`, `environment`, `visitor_id`,
`token_hash` (UNIQUE), `token_prefix`, `expires_at`,
`bound_provider_customer_id`, `bound_at`, `issued_at`, `updated_at`.

Indexes: `attribution_tokens_hash_key` (lookup by hash),
`attribution_tokens_visitor_idx` (reuse on the next click),
`attribution_tokens_workspace_idx` (diagnostics). Three, each backing a query
that exists.

RLS: enabled. `SELECT` for workspace members through `is_workspace_member`;
**no write policy at all** — writes go through the service connection on the
ingest paths, like `referral_clicks`. `anon` and `authenticated` hold nothing
(migration 0009 model); `indica_app` gets `SELECT`.

## 4. Migrations

`0016_attribution_tokens.sql`, registered in `meta/_journal.json`, applied with
`pnpm db:migrate` against the development database.

- **Backfill:** none. The table starts empty and every pre-existing flow works
  without it.
- **Rollback:** `DROP TABLE attribution_tokens`. Nothing references it; the
  product falls back to the identify path it used before.

## 5. APIs changed

| Contract | Change |
| --- | --- |
| `POST /api/track` request | **additive** — optional `token` (the reference this browser already holds) |
| `POST /api/track` response | **additive** — `token`, `null` when the click earned no eligible attribution |
| `POST /api/identify` | **unchanged** — request, response, error codes, semantics |
| `/t.js` | **additive** — `window.Referral.attributionToken`, cookie `_referral_ref`, Payment Link decoration, `data-decorate-links="off"` |
| `NormalizedBillingEvent` | **additive** — new `attribution.bind` variant; optional `attributionToken` on `payment.succeeded` and `subscription.updated` |
| Stripe events handled | **+1** — `checkout.session.completed` (records a reference, never money) |
| `GET /api/integrations/stripe/oauth`, `…/callback` | **new** |

## 6. Backward compatibility

No breaking change. A founder who does nothing keeps exactly the behaviour they
have: their tracker tag, their `identify` call, their own webhook endpoint and
signing secret all work unchanged. A tracker that never sends `token` is
accepted; an event with no reference follows the old resolution path.

The one behaviour that changed for everyone is the **order of the activation
checklist** (§11), which is copy and sequence, not contract.

## 7. Checkout methods supported

| Method | What the founder writes | Event |
| --- | --- | --- |
| Stripe Checkout | `client_reference_id` on the session | `checkout.session.completed` |
| Payment Links | **nothing** — the tracker appends it to `buy.stripe.com` links | `checkout.session.completed` |
| Elements / PaymentIntent | `metadata[indicafluxo_ref]` | `payment_intent.succeeded` |
| Subscriptions API | `metadata[indicafluxo_ref]` on the subscription, once | `customer.subscription.created`, `invoice.paid` |
| Anything else | `POST /api/identify` | unchanged |

A workspace can use all of them at once: the checkout method is not a setting
anywhere, it is only where the token was found in a payload.

## 8. How the attribution token works

- `ifx_` + 43 base64url characters (32 random bytes). The alphabet is forced by
  transport: Payment Links accept alphanumerics, `-` and `_` only, and silently
  drop anything else. A unit test asserts 200 generated tokens against that.
- Issued inside `recordClick`'s transaction, **only** for a click that produced
  or touched an eligible attribution. Its existence already means "this visitor
  was referred".
- Stored as `sha256(token + HASH_PEPPER)`. The plaintext lives in the founder's
  first-party cookie and in Stripe; never in this database.
- Resolving one yields a `visitor_id` inside one workspace and one environment,
  and grants nothing else. It is a correlation handle, not a credential.
- First bind wins. A second bind to a different customer is refused and recorded
  as `token_conflict` — the same rule as the renewal lock in `tracking.ts`.
- Expires with the attribution window. A forged or tampered token resolves to
  nothing and the payment is simply unattributed.
- The tracker sends back the one it holds, so the table stays near one row per
  visitor per window rather than one per click.

## 9. Billing identity

**Deliberately not built.** `customers` carries one `(provider,
provider_customer_id)` per row, and only Stripe is integrated — a
`billing_identities` table today would hold exactly one row per customer, which
is the abstraction CLAUDE.md rule 10 forbids.

What this phase owed the future was respected instead: the bridge resolves a
**customer** and treats the provider id as an input, never as a property other
code reads back, and `attribution_tokens` is keyed by workspace + environment
rather than by integration — so a second Stripe account, or a second provider,
needs no migration of anything written here. The 1:1 backfill that would create
`billing_identities` is recorded in `INTEGRATION_ARCHITECTURE_AUDIT.md` §4.1.

## 10. Stripe connection strategy

**Connect OAuth with `scope=read_only`**, offered only when
`STRIPE_CONNECT_CLIENT_ID` is set; manual setup unchanged and still the default.

Events then arrive at the platform Connect endpoint `/api/webhooks/stripe` —
which already existed and already routes by `event.account`. The founder creates
no endpoint, selects no events and copies no secret.

Rejected, with reasons (`INTEGRATION_ARCHITECTURE_AUDIT.md` §5):

- **Creating each endpoint via `POST /v1/webhook_endpoints`** needs the
  founder's *secret API key* — strictly worse than a signing secret.
- **A Stripe App** means a marketplace listing and a review cycle.
  Disproportionate for one button; the right move later, for distribution.
- **`read_write`, charges or payouts on behalf** — refused by the product's own
  rule. IndicaFluxo never touches money, does no KYC and holds no custody.
  `read_only` also means no access token is persisted: only the `acct_…`.

CSRF: `state` is HMAC-SHA256 over `workspace | nonce | expiry` with
`ENCRYPTION_KEY`, checked against an `HttpOnly`, `SameSite=Lax`, 10-minute
cookie. The redirect target comes from the user's own memberships, never from
the state.

## 11. Previous onboarding

```
program → invite affiliate → Stripe account id → create endpoint → select 10 events
→ paste whsec_ → install tracker (deploy) → write identify (deploy) → hope
```

## 12. New onboarding

```
program → invite affiliate → SIMULATE → 🎉 first commission (no code, no Stripe)
→ install tracker (one deploy) → choose how you charge → one reference in your checkout
→ connect Stripe (one click, when OAuth is on) → verify
```

`ACTIVATION_STEPS` was reordered so the simulated conversion comes **before**
the technical work: it runs through the real services
(`src/server/services/sandbox.ts`), needs no Stripe and no code, and is the only
step that proves the product without a deploy.

## 13. Estimated time before

**1–3 hours across at least two deploys.** Ten steps, of which three required
writing and shipping backend code (read the cookie, call identify, call it again
once the Stripe customer exists) and three were manual Stripe dashboard work
(endpoint, 10 events, signing secret).

## 14. Measured time after

**Not measured end to end, and this report will not pretend otherwise.** A real
signup-to-first-commission timing needs a Supabase account and a live Stripe
account; neither exists in this environment. `PLAN_FEATURE_AUDIT.md` §B4 records
the same limitation for platform billing.

What *is* verified is the work removed, which is what the estimate rests on:

| Path | Founder's remaining work | Deploys |
| --- | --- | --- |
| Payment Links | **none beyond the tracker tag** | 1 |
| Stripe Checkout | one field on session creation | 1 |
| Elements / PaymentIntent | one metadata key | 1 |
| Subscriptions API | one metadata key, once | 1 |
| Advanced | `identify`, as before | 2 |

Plus, with OAuth configured: three manual Stripe dashboard steps become one
click. The `identify` call and its second invocation — the two steps that cost
the most and that no competitor requires — are gone from every preset path.

## 15. Diagnostics implemented

- **Named bind outcomes** instead of silence: `bound`, `already_bound`,
  `token_unknown`, `token_expired`, `token_conflict`. They reach
  `webhook_events.error_message` through the `ignored` reason, which the
  Integrations panel already reads.
- A reference on a money event that does not resolve is logged and the payment
  still enters the ledger — it never fails the event.
- The existing attribution signal on Integrations (per Stripe mode: payments,
  payments without a customer, and why recent events earned nothing) is
  unchanged and now also covers the reference paths.

**Not built:** the dedicated Integration Health page, the event-by-event
troubleshooting list, and the `EXPECTED_UNATTRIBUTED` /
`POSSIBLE_INTEGRATION_PROBLEM` split (§18, §37, §38 of the brief). Designed in
`INTEGRATION_ARCHITECTURE_V2.md` §9; not implemented.

## 16. Tests

**Run against a real Postgres**, not mocked:
`src/server/services/__tests__/attribution-bridge.db.test.ts` — 16 tests:

reference-then-payment · payment-then-reference (backfill) · redelivery ·
PaymentIntent metadata · renewal with no reference · conflict (bound to another
customer) · unknown reference · tampered reference · expired reference ·
live event vs test reference · reference from another workspace · token reuse
and extension · identify still working alongside a bind · double bind produces
one commission · payment with no reference at all · customer row created by the
bind.

**Unit**: `src/lib/tracking/__tests__/attribution-token.test.ts` (alphabet
against the Payment Links constraint, length against
`client_reference_id`/metadata limits, uniqueness, hash never contains the
token, recognition and rejection); adapter cases for
`checkout.session.completed`, session metadata fallback, PaymentIntent,
invoice-through-subscription and subscription metadata, and "no reference leaves
the event as it was"; six tracker-script tests including the Payment Link
decoration, the opt-out and the already-set `client_reference_id`;
`contract.test.ts` now fails if a handled Stripe event has no label in both
catalogues — the exact drift that shipped a `MISSING_MESSAGE` to the public
guide and was caught in the browser rather than by a test.

**Regression**: the whole plan journey e2e (17 tests) passes unchanged except
for the `/api/track` response assertion, which now also expects the reference.

## 17. Documentation

- `INTEGRATION_ARCHITECTURE_AUDIT.md`, `INTEGRATION_ARCHITECTURE_V2.md` — new.
- Integration guide: new step 2 **"Choose how you charge"** with the four
  strategies and their snippets; `identify` becomes step 3 and opens with a
  callout saying it is optional; the flow diagram's third step no longer claims
  identify is the way; the Stripe events table gains
  `checkout.session.completed`. Both catalogues changed together, as the rule
  requires; the anchors and nav labels are in `structure.ts` and pinned by the
  contract test.
- `ARCHITECTURE.md` §3.2 rewritten (two ways in, one column written);
  `DATABASE.md` gained `attribution_tokens`; `README.md` gained *Connecting a
  founder's Stripe account*.

## 18. Remaining risks

1. **OAuth is unverified against a real Stripe account.** No Connect-enabled
   platform account exists here. The flow is written to the current docs and
   typechecks; it has not round-tripped.
2. **A reference in a Payment Link URL is shareable.** A forwarded link credits
   the first person's affiliate. Same exposure as every referral cookie in the
   market, bounded by the window and by first-bind-wins — but it is real.
3. **`checkout.session.completed` must be selected** on a manually configured
   endpoint, or strategies A and B are silent for that workspace. The guide
   lists it; nothing enforces it.
4. **P1-1 from `DOCS_IMPLEMENTATION_AUDIT.md` is still open** — identify can
   still answer `200 {ok:true}` while leaving a customer orphaned. The reference
   path makes it far rarer (no identify, no orphan) but does not fix it.
5. **Refund after a paid commission still has no clawback.** Unchanged.
6. **No product metrics were instrumented** (§66, §67 of the brief): none of
   `tracker_detected`, `attribution_token_resolved`, `integration_completed`
   exists. Without them the claim "time-to-value dropped" stays an argument
   rather than a measurement, which is why §14 above refuses to put a number on
   it.
7. **The Integration Wizard UI and the diagnostics page were not built.** The
   "Connect with Stripe" card and the reordered checklist ship; the multi-select
   "how do you charge?" step inside the product, the live per-step detection and
   the troubleshooting timeline do not.

## Validation

| Gate | Result |
| --- | --- |
| `pnpm lint` | pass, no warnings |
| `pnpm typecheck` | pass |
| `pnpm test` (no database) | **486 passed**, 108 skipped |
| `RUN_DB_TESTS=1 pnpm exec vitest run` | **592 passed, 3 skipped**, 59 files |
| `pnpm db:migrate` | applied against the development database |
| `pnpm build` | pass; both new routes present |
| Browser | `/pt-br/documentacao` and `/en/docs` render the new step; `/t.js` serves the reference logic; one `MISSING_MESSAGE` found this way and fixed, with a test added |
| Stripe OAuth round trip | **not run** — no Connect-enabled account |
| Signup → first commission timing | **not measured** — see §14 |

The 3 skipped tests are the three "set RUN_DB_TESTS=1" placeholders that exist
only to be visible when the database suites are off.
