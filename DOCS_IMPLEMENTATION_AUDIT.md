# Docs ↔ implementation audit

Date: 2026-09-17 · Working tree (uncommitted changes included) · SDK `stripe@22.6.2`,
pinned API version `2026-08-26.dahlia`.

Scope: every technical claim the public integration guide makes — the pt-br and
en `docs` catalogues (`src/i18n/messages/*.json`), the page that renders them
(`src/app/[locale]/(docs)/docs/page.tsx`) and the code samples built from the
API's own constants (`src/features/docs/snippets.ts`) — checked against the code
that implements it. **No behaviour was changed to make the guide look right**, and
no financial, attribution, pricing or security rule was touched.

Classification: **MATCH** · **DOC_WRONG** (implementation exists, the guide
describes it incorrectly or incompletely) · **IMPLEMENTATION_MISSING** (the guide
promises something that does not exist) · **IMPLEMENTATION_DIVERGED** (something
similar exists, real behaviour differs) · **UNCLEAR** (not provable from code or
tests) · **DEAD_IMPLEMENTATION** (code exists, unreachable in the current flow).

Severity: **P0** financial risk, security, or a critical false promise · **P1** the
guide can make a real integration fail or lose money · **P2** different behaviour,
workaroundable · **P3** naming/clarity · **P4** cosmetic.

---

# Executive summary

| Metric | Value |
| --- | --- |
| Contracts audited | **308** (285 behavioural claims + 23 UI references) |
| MATCH | **241** (78%) |
| DOC_WRONG | **26** |
| IMPLEMENTATION_DIVERGED | **15** |
| IMPLEMENTATION_MISSING | **3** |
| DEAD_IMPLEMENTATION | **5** |
| UNCLEAR | **18** |
| P0 | **0** |
| P1 | **3** |
| P2 | **14** |

`DOCS_IMPLEMENTATION_STATUS = PARTIALLY_ALIGNED`
`PUBLIC_API_DOCS_STATUS = NEEDS_FIXES`
`FINANCIAL_RULES_DOCS_STATUS = NEEDS_REVIEW`
`SECURITY_DOCS_STATUS = NEEDS_REVIEW`

The guide is substantially true: every documented endpoint exists, every
documented field is accepted, every documented error code is reachable, every
documented Stripe event is a real Stripe event with a handler, and the commission
arithmetic in the guide is the arithmetic the engine runs. What it does not yet
do is warn about the three narrow paths where a *correct-looking* integration
silently earns nothing (C-1, I-1, S-2), and it overstates three things it cannot
back: "nunca ponto flutuante", an unconditional dispute-won restoration, and a
publishable key that "não altera dados".

None of the gaps is a false promise about money already earned. The
P1s are about money **not** earned, and are invisible to the founder — which is
why they lead the list.

---

# Critical findings

### P1-1 · identify can never attach a `providerCustomerId` a webhook already claimed
`src/server/services/identify.ts:117,126-128,148-152` · **IMPLEMENTATION_DIVERGED**

The guide tells the founder (`identifyCustomer.facts.whenValue`) to call identify
again once the Stripe customer exists, and calls repetition "segura"
(`identifyApi.idempotencyValue`). If the first identify carried **no e-mail** and a
Stripe event created a customer row for that `cus_` first
(`src/server/services/billing-events.ts:318-322`), the second identify finds the
provider id owned by another row, keeps `null`, logs a warning and still answers
`200 {ok:true}`. Two customer rows survive; every payment resolves to the orphan
and no commission is ever created. Nothing in the response tells the caller.

REQUIRES_PRODUCT_DECISION (see below). Doc mitigation applied: the e-mail is now
documented as required in that ordering.

### P1-2 · `subscriptions` unique key is not workspace-scoped
`src/server/db/schema/billing.ts:94` + `billing-events.ts:588-599` ·
**IMPLEMENTATION_DIVERGED** (tenant isolation)

`uniqueIndex("subscriptions_provider_key").on(provider, providerSubscriptionId)`
with `onConflictDoUpdate` lets an event signed by workspace A's own (legitimately
known) `whsec_` update workspace B's subscription row — status, amount, periods.
`workspace_id`/`customer_id` are not in the SET, so rows are not stolen, but they
are writable across tenants by anyone who guesses a `sub_` id. Not documented,
not a docs problem: scope the index to `workspace_id`.

### P1-3 · legacy `/api/webhooks/stripe` trusts a self-declared `acct_`
`src/app/api/webhooks/stripe/route.ts` + `billing-events.ts:92-98` ·
**DEAD_IMPLEMENTATION / security**

The route maps `event.account` to whichever integration typed that id
(`integrations_account_idx` is non-unique, `schema/platform.ts:47-49`), and
nothing proves account ownership — `features/integrations/actions.ts:27-30` only
checks the format. With `STRIPE_WEBHOOK_SECRET` set, a founder who types someone
else's `acct_` id receives that account's Connect events. The guide correctly
says there is no OAuth/Connect flow, so this route serves no documented purpose.
Recommendation: delete it, or bind it to a verified account.

### P2 shortlist (detail in the sections below)

| ID | Finding | Area |
| --- | --- | --- |
| C-1 | Duplicate commission is only repaired by `invoice_payment.paid`; nothing detects that the founder left it unselected | Stripe events |
| W-1 | An exception between the event claim and the `try` block loses the event: the retry inside 10 min answers `200 duplicate` | Webhook idempotency |
| W-2 | `webhook_events` is unique on `(scope, provider, event_id)` with no workspace — two workspaces on one Stripe account silently drop each other's events | Webhook idempotency |
| M-1 | A partial reversal already claimed by a payout batch is not settled when the original is later fully refunded → affiliate under-paid | Commissions |
| A-1 | A paused/archived program keeps paying commissions on existing attributions and renewals | Attribution |
| A-2 | Once the window expires, any later click re-opens attribution for a new affiliate — in **both** models | Attribution |
| A-3 | "Visão geral" funnel dates sign-ups by the click, not by the identify | UI/docs |
| T-1 | Safari/iOS caps a JS-set cookie at 7 days; the guide promises 365 | Tracker |
| T-2 | `data-cookie-domain` exists and is required for `app.`/`www.` splits — undocumented | Tracker |
| I-1 | A `providerCustomerId` owned by another `externalId` is silently ignored, answered `200` | Identify |
| I-2 | Rate limit runs before authentication, keyed on a client-supplied `x-forwarded-for` | Security |
| S-1 | Payment without a Stripe customer answers `200`; the loss is invisible in Stripe's delivery log | Customer matching |
| S-2 | Unauthenticated DB read + unbounded body read before signature verification, no rate limit | Security |
| P-1 | `programs.environment` immutability is service-only — no DB trigger/check | Test vs production |

---

# Tracker

47 claims · 32 MATCH · 9 DOC_WRONG/gap · 1 DIVERGED · 2 DEAD · 3 UNCLEAR.

| Claim | Evidence | Status |
| --- | --- | --- |
| Script path `/t.js`, public, not locale-rewritten | `lib/tracking/constants.ts:6`, `app/t.js/route.ts:19-29`, `proxy.ts:36-43,119` | MATCH |
| `data-key` read from `document.currentScript` | `lib/tracking/script.ts:21-25` | MATCH |
| Params `?ref=`, `?via=`, `?aff=` | `constants.ts:4`, rendered from the constant `docs/page.tsx:273` | MATCH |
| Precedence when several are present | `script.ts:80-83` — first non-empty, in order | DOC gap (P4) |
| Code format "2 a 49 caracteres: letras, números, `-`, `_`" | `lib/tracking/visitor.ts:25-26` — first character must be alphanumeric; uppercase accepted and lowercased; ≥65 chars fails Zod as `invalid_payload` first | DOC_WRONG (P3) |
| No referral → only the cookie is renewed | `script.ts:76,93` | MATCH |
| `window.Referral.visitorId` on every page | `script.ts:87-91` | MATCH |
| visitorId `v_` + 16–48 lowercase alphanumerics | browser writes exactly 24 (`script.ts:59-70`); server accepts 16–48 (`visitor.ts:19-21`) | MATCH |
| Cookie `_referral_id`, `SameSite=Lax`, `Secure` on HTTPS, `Path=/` | `script.ts:52-56` | MATCH |
| 365 days | `constants.ts:5`, `script.ts:20` (`Max-Age`) — Safari/iOS ITP caps JS-set cookies at 7 days | DOC_WRONG in practice (**P2**, T-1) |
| Renewed on every page load | `script.ts:76` | MATCH |
| `data-cookie-domain` (subdomain sharing) | `script.ts:41-49,53` — works, tested, **absent from the guide** | DOC gap (**P2**, T-2) |
| Payload: key, code, visitorId, url, referrer, `utm_*` | `script.ts:95-108` (`utm` is a nested object) | MATCH |
| Posts to the host that served the script | `script.ts:29-32` | MATCH |
| Retry | `fetch` + `keepalive`, errors swallowed, **no retry**; the `sendBeacon` branch is unreachable | MATCH (guide claims none) / DEAD (P4) |
| Tampered cookie → `invalid_visitor` | `script.ts:73-75` replaces an invalid value itself, so a real tracker never sends one; a malformed `%` escape throws in `decodeURIComponent` (`script.ts:38`) and kills the tracker | DOC_WRONG (P3) + robustness bug |
| Server-side `generateVisitorId` | `visitor.ts:10-17` — used only by its own test; comment claims 128 bits, gives ≈124 | DEAD (P4) |
| Publishable key "não lê nem altera dados" | a `pk_` creates and reassigns attributions (`services/tracking.ts:157-182`), updates `last_used_at`, and leaks existence of a code (404 vs 200) | DOC_WRONG (P3) |

Tests: `script.test.ts`, `visitor.test.ts`, `snippets.test.ts` run in CI.
Untested: `via`/`aff`, cookie flags, the browser id generator, CSP/ITP paths.

---

# Track API

| Item | Reality | Status |
| --- | --- | --- |
| Method / CORS | `POST` + `OPTIONS` 204, `ACAO: *` on every response including errors, `credentials: "omit"` (`app/api/track/route.ts:37-46`) | MATCH |
| Check order | 429 → `invalid_payload` → `invalid_ref` → `invalid_visitor` → `unknown_key` → **204 live-mode** → 404 → 500 (`route.ts:51-80`, `services/tracking.ts:64-69`) | Docs table lists 404 before 204 (P4) |
| `invalid_payload` | Zod: url ≤ 2000, referrer ≤ 2000, key 8–128, ref ≤ 64, utm ≤ 200 (`route.ts:21-23`) | MATCH |
| `unknown_key` 401 | unknown, revoked, `sk_`, wrong type, prefix/row env mismatch (`services/api-keys.ts:227-232`) | MATCH |
| `not_found` 404 | no affiliate with that code in that environment (`tracking.ts:206-230`) | MATCH |
| `204` without live mode | `tracking.ts:64-66,195-198` — also covers `restricted` past grace | MATCH |
| `200 { attributed: false }` for paused program / unapproved affiliate | `tracking.ts:73,105`, `route.ts:103` | MATCH, **untested** |
| Meaning of `attributed: true` | also true when first-click or the renewal lock keeps **another** affiliate | DOC gap (P3) |
| Duplicate clicks | no dedupe — every page load with `?ref=` inserts a row (`tracking.ts:77`) | undocumented (P3) |
| Rate limit "60/min por IP" | token bucket: burst 60 then 1/s ⇒ ≈119 in the first minute; in-process, per instance; map wiped at 20 000 keys (`lib/rate-limit.ts:24-52`) | IMPLEMENTATION_DIVERGED (P4) + security (P2) |
| Idempotency | none claimed, none implemented | MATCH |

---

# Identify API

57 claims · 44 MATCH · 3 DOC_WRONG · 5 DIVERGED · 4 UNCLEAR · 1 MISSING.

| Claim | Evidence | Status |
| --- | --- | --- |
| `POST /api/identify`, only POST exported | `app/api/identify/route.ts:22` | MATCH |
| `Authorization: Bearer sk_…`, publishable → 401 | `route.ts:34-38`, `api-keys.ts:192-203` | MATCH |
| Bearer scheme parsing | `route.ts:35` `startsWith("Bearer ")` — case-**sensitive**; `bearer sk_…` → `missing_credentials`, contrary to RFC 9110 | IMPLEMENTATION_DIVERGED (P3) |
| "não responde a requisições do navegador (sem CORS)" | no CORS headers anywhere for this route; Next auto-implements `OPTIONS` → **204 + `Allow: OPTIONS, POST`**. The browser is blocked at the preflight, not by the server refusing to answer | DOC_WRONG, imprecise (P3) |
| `visitorId` `v_…` 16–48 | `contract.ts:9` (4–64) + `visitor.ts:20` regex in the route | MATCH |
| `externalId` 1–200, trimmed, whitespace-only → `422 validation_error` | `contract.ts:10`, `identify.ts:48-51` | MATCH |
| `providerCustomerId` "(`cus_…`), até 200 caracteres" | `contract.ts:11` — length only, **no format check** | DOC_WRONG (P4) |
| `email` valid, ≤320, stored only as a peppered SHA-256 of the trimmed lowercase address | `contract.ts:13`, `lib/crypto/hash.ts:12-14`, `identify.ts:58` | MATCH |
| `provider` default `stripe`, "o único integrado hoje" | `contract.ts:12`, `identify.ts:56` — `paddle`/`manual` are stored and then never matched by the Stripe webhook (`billing-events.ts:271`), so commissions are silently lost | IMPLEMENTATION_DIVERGED (P3) |
| `{ ok, customerId, attributionsBound }` | `route.ts:65-69` | MATCH |
| `attributionsBound` = open ones bound now **plus** ones already this customer's, one per program, environment-scoped | `identify.ts:172-195` | MATCH |
| Repeating never erases a stored `providerCustomerId` or e-mail | `coalesce`, `identify.ts:126-129` — asymmetric: a new e-mail **does** replace the stored hash | MATCH / undocumented asymmetry (P3) |
| Provider id owned by another `externalId` | kept `null`, warning logged, still `200` | IMPLEMENTATION_DIVERGED (**P1-1**, **P2** I-1) |
| Stripe-created customer merged on identify | `identify.ts:136-146` | MATCH |
| Concurrent identify | unique-violation retry (`identify.ts:61-67,202-209`) | MATCH |
| Rate limit 120/min/IP + `Retry-After` | `contract.ts:19`, `route.ts:23-32` — same in-process bucket, applied **before** authentication | MATCH / security P2 |
| Error order | matches the guide, except `SUBSCRIPTION_REQUIRED` is checked before `LIVE_MODE_REQUIRED` (`services/entitlements.ts:59-62`) | P4 |

---

# Customer matching

`src/server/services/billing-events.ts:254-366`.

| Step | Reality |
| --- | --- |
| 1 | `providerCustomerId` exact match (`:264-277`) |
| 2 | peppered e-mail hash, **exactly one** identified customer, with no provider id or the same one (`:279-313,349-366`); the Stripe id is back-filled only onto an empty column (`:286-290`) and onto the bound attributions |
| 3 | otherwise a new customer row is created by the webhook (`:319-338`) |
| No `providerCustomerId` on the event | `resolveCustomer` returns `null` **before** the e-mail is read (`:262`) — the payment is not recorded at all (`PAYMENT_WITHOUT_CUSTOMER`, `:709-724`) |

So `receipt_email` and `invoice.customer_email` only matter for a payment that
**has** a Stripe customer — the guide's wording invites the opposite reading
(P4). `customer_creation: always` for Payment Links / one-off Checkout is
correctly documented and correctly enforced by the wizard's checklist.

**S-1 (P2):** a dropped payment answers `200`, so Stripe's delivery log shows
"Succeeded" and the founder sees nothing there. The loss is surfaced only on
Integrações, as the "Recebendo, sem comissão" state
(`0015_webhook_payment_drops.sql`, `integration-health.ts:182-184`,
`stripe-status.ts:88`). The guide did not say this.

An ambiguous e-mail (two identified customers) silently matches nothing
(`:349-366`) — undocumented (P4).

---

# Stripe integration

| Claim | Evidence | Status |
| --- | --- | --- |
| No OAuth / Stripe Connect in the founder flow | `[integrationId]/route.ts:36-97`, `integrations.ts:132-226` | MATCH |
| `buildConnectUrl` / `exchangeConnectCode` | `adapter.ts:279-297`, no API route imports them | DEAD (P4) |
| `acct_…` id validated `^acct_[A-Za-z0-9]{8,}$` | `features/integrations/actions.ts:27-30` | MATCH |
| …and used for anything in the documented flow | never compared with `event.account` (`route.ts:26-27`); display-only | DEAD (P3) |
| Signing secret AES-256-GCM, never shown again | `lib/crypto/secrets.ts:7-48`, `integrations.ts:110-123` | MATCH |
| Two secrets per integration, saved independently | `integrations.ts:38-52,196-198` | MATCH |
| Delivery verified against both, `livemode` must agree | `webhook.ts:70-83`, 400 `livemode_mismatch` | MATCH |
| Signature checked on the raw body, 300 s tolerance (default) | `webhook.ts:20` | MATCH (tolerance undocumented) |
| Same URL in both Stripe modes, one endpoint per mode | `events.ts:27-29` | MATCH |
| Integration ids are `gen_random_uuid()` v4 | `schema/platform.ts:25` | MATCH (not enumerable) |

**S-2 (P2):** the route does a DB read (`integrations.ts:272-280`) and an
unbounded `request.text()` before any signature check, with no rate limit, and
anyone holding an integration id can pin the panel to "Assinatura recusada" via
`recordWebhookRejection` (throttled to one write/minute).

---

# Stripe events

All ten documented types exist in `stripe@22.6.2` (`resources/Events.d.ts`) and
all ten have a handler. The guide's table is generated from
`STRIPE_HANDLED_EVENTS` and a test pins it to the adapter's `switch`.

| Event | Handler | Actual behaviour | Status |
| --- | --- | --- | --- |
| `invoice.payment_succeeded` | `adapter.ts:97` | payment under `invoice.id`; `amount_paid === 0` ignored | MATCH |
| `invoice.paid` | `adapter.ts:98` | identical; the second of the pair hits the `transactions` unique key and records nothing | MATCH (redundant by design) |
| `payment_intent.succeeded` | `adapter.ts:129` | payment under `pi_`; on dahlia a PI never names its invoice, so subscription PIs are recorded as one-offs until the link event reconciles | MATCH (see C-1) |
| `invoice_payment.paid` | `adapter.ts:114` | links `in_ ↔ pi_/ch_`, reverses a duplicate record | MATCH |
| `refund.created` | `adapter.ts:151` | refund under `re_`; failed/canceled/zero ignored | MATCH |
| `charge.dispute.created` | `adapter.ts:175` | chargeback under `dp_`, proportional to `dispute.amount` | MATCH |
| `charge.dispute.closed` | `adapter.ts:189` | `won` **and `warning_closed`** restore; `lost` → ignored | DOC incomplete (P4) |
| `customer.subscription.created` / `.updated` | `adapter.ts:202` | upsert `subscriptions`; feeds the funnel's "trials" | MATCH (not dead) |
| `customer.subscription.deleted` | `adapter.ts:213` | status `cancelled`, `cancelled_at` | MATCH |
| anything else | `adapter.ts:224` | claim row marked `ignored`, 200 | MATCH |

**C-1 (P2, REQUIRES_PRODUCT_DECISION):** the duplicate-commission repair depends
entirely on the founder having selected `invoice_payment.paid`. Select nine of
ten and a subscription payment earns **two** commissions, permanently and
silently. Even in the happy path there is a window; a payout batch created inside
it records a reversal with no clawback (`billing-events.ts:998-1004`).

---

# Webhook idempotency

Three independent barriers, all proven by tests:

1. **Event id.** `claimWebhookEvent` (`repositories/webhook-events.ts:44-70`)
   inserts on `UNIQUE (scope, provider, provider_event_id)` and re-claims only a
   `failed` row, or a `received` one older than `STALE_CLAIM_MINUTES = 10`. A
   redelivery of a processed event answers `200 { duplicate: true }`.
2. **Money keys.** `transactions` is unique on
   `(workspace_id, provider, provider_transaction_id)` with
   `onConflictDoNothing` on every write path — payments, `re_`/`dp_` refunds,
   `dup_` adjustments, `won_` restorations.
3. **Cross-id identity.** `transaction_references` maps `in_/pi_/ch_` to the id a
   payment is recorded under, and every payment-touching write takes sorted
   `pg_advisory_xact_lock`s on the ids it knows
   (`billing-events.ts:405-409`) — deadlock-free, and it serialises the
   PaymentIntent event, the invoice event and the link event.

`invoice.payment_succeeded` + `invoice.paid` for one invoice normalise to the
same `providerTransactionId`, so the second records nothing. PI + invoice (which
share no id on dahlia) can both record; `invoice_payment.paid` then keeps the
commissioned one, repoints every reference and reverses the other with a `dup_`
adjustment — nothing deleted, net one commission. Tested in
`billing-events.db.test.ts:439,453,467,508` (both orders, redeliveries, and all
three concurrent).

So **"reentregas não duplicam comissão" is proven** — with two caveats the guide
does not mention:

- **W-1 (P2):** `normalizeEvent` and both `markWebhookEvent` calls sit *outside*
  the try/catch (`billing-events.ts:166,174,185`). A throw there leaves the row
  in `received`; Stripe's retry inside 10 minutes is answered `200 duplicate` and
  the event is gone, with the panel still green.
- **W-2 (P2):** the claim key has no `workspace_id` for the `customer_billing`
  scope (`schema/platform.ts:110`). Two workspaces on one Stripe account (a
  staging/production split) silently swallow each other's events.

---

# Retries and status codes

`200` processed / `200 { duplicate: true }` / `200 { ignored: … }` /
`400 missing_signature|invalid_signature|livemode_mismatch` / `404 not_found` /
`500 processing_failed`. A failed event is recorded with its message (≤500 chars)
and re-claimed on the next delivery, so Stripe's retry really does reprocess it —
the guide's `connectStripe.notes.retry` is correct.

Undocumented: an unhandled throw outside the try/catch answers a non-JSON Next
500, and a payment drop answers `200 { received: true }` (not `ignored`).

---

# Attribution

| Claim | Reality | Status |
| --- | --- | --- |
| One attribution per (program, visitor) | `schema/tracking.ts:104` | MATCH |
| Created only on an active program with an approved participation | `services/tracking.ts:73` | MATCH |
| Paused-program clicks recorded, no attribution created or changed | `tracking.ts:77-96,105` | MATCH (`draft`/`archived` behave the same — the guide names only "pausados") |
| `expires_at` = click + days, 1–365, default 60, model default last click | `domain/attribution.ts:45-47`; DB `schema/programs.ts:53-54,67-70`; Zod `features/programs/schema.ts:54`; form `programs/new/page.tsx:53-54` — **all four agree** | MATCH |
| First click: A keeps the credit, B's click "não muda nada" | `attribution.ts:98-109` — B's click does update `last_click_id`/`updated_at` | DOC_WRONG (P4) |
| Last click: B takes over, window restarts | `attribution.ts:83-94`, row updated in place | MATCH |
| After the window expires | **any** later click replaces the attribution, in *both* models (`attribution.ts:71-81`) — the guide is silent | DOC gap (**P2**, A-2) |
| Renewal lock after identify | `tracking.ts:130-147` — a click from a *different* affiliate never moves credit, even after expiry | MATCH |
| …same affiliate after binding | still goes through the model, so it can extend `expires_at` post-signup | undocumented (P3) |
| Window gates the first payment; renewals follow the program's duration | `domain/commission.ts:164-181`, anchor = first commissioned payment's date | MATCH |
| Day 61 → no commission | `commission.ts:166-171` (`attribution_expired`) | MATCH |
| Payment path checks "programa ativo" | it does **not** — only the participation's approval is checked (`billing-events.ts:766`, `commission.ts:141`) | IMPLEMENTATION_DIVERGED (**P2**, A-1) |
| One customer attributed in two programs | `findAttribution` returns one row → one commission | undocumented (P3) |
| `first_click_id` after a last-click takeover | still points at the *previous* affiliate's click (`attribution.ts:88`), and the conversion trail reads it | IMPLEMENTATION_DIVERGED (P3) |

---

# Commission engine

69 claims · 56 MATCH. The worked example (4900 × 3000 bps = 1470) and the column
names (`base_amount_minor`, `commission_rate`, `commission_amount_minor`) are
computed and read from the real code and schema.

**Rounding (`src/lib/money.ts:34-41`).** `roundHalfUp(amountMinor * bps / 10_000)`
with a sign wrapper, so it is half-up **away from zero** — `-2.5 → -3`, not
`Math.round`'s `-2`. The intermediate division is floating point, but the product
is an exact integer below 2^53 and a true midpoint is exactly representable, so
the result is *exactly* half-up for every `|amountMinor × bps| < 2^53`. The
guide's "nunca ponto flutuante" is therefore literally false for the percentage
path (true only for reversals, which are BigInt). No `MAX_SAFE_INTEGER` guard
exists anywhere (**P3**), and `ZERO_DECIMAL` (`money.ts:13`) misses eight
zero-decimal ISO currencies and mis-scales the three-decimal ones (**P3**) —
which affects fixed rates and formatting, never the bps math.

| Rule | Reality | Status |
| --- | --- | --- |
| Percentage, fixed (`commission_rate` null), custom affiliate rate overriding both value and type | `domain/commission.ts:79-123` | MATCH |
| Fixed amount is **not** capped at the payment | `commission.ts:122` | undocumented (P3) |
| Conditions: approved participation, program currency (case-insensitive, no conversion), amount > 0, first payment inside the window, renewals inside the duration | `commission.ts:140-181` | MATCH |
| A commission that rounds to 0 is skipped | `commission.ts:185-187` | undocumented (P4) |
| Duration: `1` = first payment only, `N` months, `NULL` = lifetime; strict `<` with end-of-month clamping | `commission.ts:94-113,176-179` | MATCH |
| "First payment" = first payment that *earned a commission* | `billing-events.ts:806-824` — a payment skipped for currency or approval does not consume the window; a first payment outside the window blocks every renewal forever | UNCLEAR (**P2**) |
| Cancel + resubscribe does not restart the window or the duration | anchor is per participation+customer forever | undocumented (P2) |
| Hold: default 30, 0–180, `eligible_at = payment date + hold`, hold 0 → born `available` | `commission.ts:195`, `billing-events.ts:846` (**note:** `DATABASE.md:168` and `schema/ledger.ts:53` still say `created_at + hold` — internal doc is wrong) | MATCH |
| `pending → available` is computed, not a job | `commission.ts:346-353` + SQL mirror `repositories/commissions.ts:82-88`; persisted only inside `createPayoutBatch` | MATCH (no cron exists, none claimed) |
| Reversal: negative row, cumulative proportional, capped, original flips only on a full refund of an unpaid commission, a paid commission is never clawed back | `commission.ts:223-300`, `billing-events.ts:1199-1218` | MATCH |
| Dispute won restores the reversal as `pending` under a **fresh** hold from the dispute-close date | `billing-events.ts:1374-1392` | MATCH (the guide says only "em retenção") |
| "Se a disputa for vencida, o valor revertido volta" | conditional: nothing is restored if the commission had already been paid (`commission.ts:315-329`) | DOC_WRONG (P3) |
| Dispute lost | ignored; the chargeback reversal stands | undocumented (P4) |
| Refund + dispute on one payment do not double-reverse | `billing-events.ts:1118-1141,1183-1184` + cap | MATCH |

**M-1 (P2, REQUIRES_PRODUCT_DECISION):** prior partial reversal rows are settled
to `reversed` only while `pending`/`available` (`billing-events.ts:1024-1035`). A
partial reversal already claimed by a payout batch (`approved`) keeps deducting
after the original was fully reversed → the affiliate is under-paid. Narrow, but
it lands on the money side.

---

# Commission lifecycle

| DB `commission_status` | Dashboard | Affiliate portal | Generic badge fallback | Guide |
| --- | --- | --- | --- | --- |
| `pending` | Pendente | **Em retenção** | Pendente | Pendente |
| `available` | Disponível | Disponível | Disponível | Disponível |
| `approved` | Em lote | Em lote | **Aprovada** | Em lote |
| `paid` | Paga | Paga | Paga | Paga |
| `reversed` | Revertida | Revertida | Revertida | Revertida |
| `rejected` | Rejeitada | **Recusada** | Rejeitada | *(absent — never written)* |

Every state the guide names exists. Two problems, neither in the guide: `rejected`
is a **DEAD_IMPLEMENTATION** (no service writes it, yet three catalogues label it
and the filters offer it — T31, still open), and `StatusBadge` renders an
unlabelled commission as "Aprovada" instead of "Em lote"
(`components/ui/badge.tsx:111-130`, used at `programs/[programSlug]/page.tsx:447`
and `overview/page.tsx:535`) — a fourth vocabulary for one row.

---

# Refunds

Proportional and cumulative:
`round_half_up(commission × refunded_so_far / base) − already reversed`, exact
BigInt (`commission.ts:204-245`), capped at the commission, one transaction per
`re_` id so partial refunds never drift or collide. The original flips to
`reversed` only when refunds cover the whole payment and it was not paid. A refund
arriving before its payment answers `500` (`PaymentNotRecordedYetError`) so Stripe
retries. Nothing is ever deleted. All of this matches the guide; the open gaps
are M-1 above and the undocumented "paid commission is never clawed back, and the
negative row therefore never nets" consequence (already stated in the guide).

# Disputes

`charge.dispute.created` reverses proportionally to `dispute.amount`;
`charge.dispute.closed` restores only for `won`/`warning_closed`, only when the
reversal actually came out of the affiliate's balance, as a new `pending` row
under a fresh hold. `lost` is a no-op. The guide's unconditional phrasing is the
only DOC_WRONG here (P3).

# Retention

Default 30 days, 0–180, counted from the **payment date**; DB check, Zod schema
and form input all agree with the guide. `pending → available` is derived from
the clock at read time in both TypeScript and SQL — two copies of one rule, with
no test asserting they agree (see Tests).

---

# Test vs production

| Claim | Evidence | Status |
| --- | --- | --- |
| "Todo programa nasce em teste ou produção e não muda depois" | `services/programs.ts:167-172` throws `programEnvironmentImmutable`; `updateProgram` never writes `environment` | MATCH at the service |
| …enforced in the DB | no trigger/check/RLS on `programs.environment` | IMPLEMENTATION_MISSING (**P2**, P-1) |
| "Ir para produção" = convert? clone? promote? | **A new live program is created.** `createProgram` (`programs.ts:111`) is the only writer. The create form offers "copiar configurações de um programa de teste" (`program-form.tsx:251-262`) — settings only; name, affiliates and data are not copied. The guide omits this shortcut | MATCH + DOC gap (P3) |
| "aprove os afiliados nele" | founder-side enrolment auto-approves (`services/affiliates.ts:142`); there is no approval step, and an affiliate already in the workspace gets no new invitation | DOC_WRONG (P3) |
| Data isolation | `environment` on programs, customers, transactions, payout batches; clicks/attributions/commissions inherit it through `program_id`, and every query joins it | MATCH |
| Keys per environment, live keys only with live mode | `api-keys.ts:106,124` | MATCH |
| Stripe by `livemode`, same URL both modes | `route.ts:61-86` | MATCH |
| "Dados de teste" toggle | `nav.environment.switchLabel`, `components/layout/environment-switch.tsx`, `services/view-environment.ts:44-51` (a preference, never an authorisation) | MATCH |
| "Simular conversão" runs click + identify + payment through the real services, plus renewal and refund | `services/sandbox.ts:132,184,199,232,255,304`; test programs only | MATCH (renewal and refund are separate buttons — the en catalogue already says "can also") |
| Live mode: Launch or Growth | `lib/plans.ts:31-48` — `scale` also has it but is `public:false`; `active` includes `trialing`, plus a 7-day past-due grace (`domain/entitlements.ts:16,81-95`) | MATCH, incomplete wording (P3) |
| Without live mode: track `204`, identify `402 LIVE_MODE_REQUIRED`, live Stripe events acknowledged without a `webhook_events` row so they can be re-sent | `tracking.ts:64`, `identify.ts:83`, `billing-events.ts:135-142` | MATCH |

---

# API keys

| Claim | Evidence | Status |
| --- | --- | --- |
| `pk_test_`/`pk_live_`/`sk_test_`/`sk_live_` + 24 random bytes base64url | `lib/crypto/hash.ts:45-55` | MATCH |
| Stored only as a peppered SHA-256, unique on the hash | `hash.ts:8-10`, `schema/platform.ts:53,68-69,76` | MATCH |
| Shown once, never returned again | `api-keys.ts:89-98` selects no secret; the plaintext travels once through the action result | MATCH (no test pins it) |
| "Gerar uma nova invalida a anterior na hora" | revoke + insert in one transaction (`api-keys.ts:122-174`), auth reads the DB per request with no cache | MATCH |
| Rotation is per type **and** per environment | `api-keys.ts:129-135` | MATCH |
| Exactly one active key per (type, environment) | no partial unique index — two concurrent rotations can leave two active rows | IMPLEMENTATION_MISSING (P4) |
| Key is workspace-scoped, rotation is admin-only and audited | `api-keys.ts:123,139-171` | MATCH |

---

# Rate limits

`src/lib/rate-limit.ts` is an in-process token bucket: 120/min for identify,
60/min for track, refilling continuously, so a cold bucket allows a full burst
plus the refill (≈2× the nominal number in the first minute). It is **per server
instance**, lost on restart, and the whole map is cleared once it holds 20 000
keys. The key is the first `x-forwarded-for` entry, applied **before**
authentication. `Retry-After` is sent on 429 for both routes.

The guide states the numbers as if they were a global guarantee. They are a
per-instance floor, spoofable if the edge does not overwrite the header, and
shared by every tenant behind one IP (**I-2, P2**).

---

# Error codes

| ERROR_CODE | Route | Documented | Actual | Location | Reachable | Match |
| --- | --- | --- | --- | --- | --- | --- |
| `rate_limited` | identify / track | 429 | 429 + `Retry-After` | `identify/route.ts:27`, `track/route.ts:51` | yes | ✅ |
| `missing_credentials` | identify | 401 | 401 | `identify/route.ts:36` | yes (also for lowercase `bearer`) | ✅ cause imprecise |
| `invalid_payload` | identify / track | 400 | 400 | `identify/route.ts:41`, `track/route.ts:60` | yes | ✅ |
| `invalid_visitor` | identify / track | 400 | 400 | `identify/route.ts:47`, `track/route.ts:71` | yes (hand-made POST only) | ✅ cause wrong |
| `unauthorized` | identify | 401 | 401 | `api-keys.ts:198,202` | yes | ✅ |
| `validation_error` | identify | 422 | 422 | `identify.ts:50` | yes | ✅ |
| `LIVE_MODE_REQUIRED` | identify | 402 | 402 | `services/entitlements.ts:61` | yes | ✅ |
| `SUBSCRIPTION_REQUIRED` | identify | 402 | 402 | `services/entitlements.ts:60` | yes, checked first | ✅ order inverted |
| `internal_error` | identify / track | 500 | 500 | both routes | yes | ✅ |
| `invalid_ref` | track | 400 | 400 | `track/route.ts:66` | yes | ✅ cause incomplete |
| `unknown_key` | track | 401 | 401 | `track/route.ts:77` | yes | ✅ |
| `not_found` | track | 404 | 404 | `services/tracking.ts:68` | yes | ✅ listed before 204 |
| *(no body)* | track | 204 | 204 | `track/route.ts:97` | yes | ✅ |
| `not_found` | webhook | 404 | 404 | `[integrationId]/route.ts:42,54` | yes | ✅ |
| `missing_signature` | webhook | 400 | 400 | `route.ts:47` | yes, checked **before** the lookup | ✅ order |
| `invalid_signature` | webhook | 400 | 400 | `route.ts:77,86` | yes | ✅ |
| `livemode_mismatch` | webhook | 400 | 400 | `route.ts:86` | yes | ✅ |
| `processing_failed` | webhook | 500 | 500 | `responses.ts:18` | yes | ✅ |
| `duplicate` | webhook | 200 | 200 | `responses.ts:8` | yes | ✅ |
| `ignored` | webhook | 200 | 200 | `responses.ts:11` | yes | ✅ cause incomplete |
| *(none)* — method not allowed | identify | — | **405, empty** | Next auto-implementation | yes | ❌ undocumented |
| *(none)* — `OPTIONS` | identify | — | **204 + `Allow`** | Next auto-implementation | yes | ❌ undocumented, contradicts the CORS sentence |
| *(none)* — unhandled throw | webhook | — | **500 non-JSON** | outside the try/catch | yes | ❌ undocumented |
| *(none)* — payment drop | webhook | — | **200 `{received:true}`** | `billing-events.ts:173-182` | yes | ❌ undocumented |

**Casing.** Two vocabularies share one field: snake_case for route and `AppError`
codes, UPPER_SNAKE for the four plan errors — because those same identifiers are
the dashboard's contract (`src/i18n/errors.ts:33-56`,
`features/plans/action-error-alert.tsx:36`) and are documented as such in
`docs/PLANS.md:105-108`. The guide mirrors reality faithfully; the API looks
inconsistent to a founder. Not changed — see Product decisions.

---

# UI / docs consistency

Every dashboard page the guide names exists, and every label it quotes exists
verbatim, with three exceptions:

| Doc term | Route | UI label | Verdict |
| --- | --- | --- | --- |
| "programa ativo com o **site do produto preenchido**" | `programs/new` | "Site do produto" is **optional** (`features/programs/schema.ts:40`) and collapsed in the onboarding variant | DOC_WRONG (P3) |
| "se mostrar **assinatura inválida**" | `integrations` | the badge reads "Assinatura recusada"; only the long health title says "assinatura inválida" | P4 |
| "Configurar o Stripe" | `integrations`, overview activation | the product still says "Conectar Stripe" (`forms.stripe.connect`, `dashboard.overview.activation.steps.stripe.*`) | T23, still open (P3) |

Also: after the recommended `stripe trigger invoice.paid` with no affiliate click
behind it, the badge reads "Recebendo, sem comissão", not "Recebendo eventos"
(`stripe-status.ts:83-90`) — expected, but the guide predicts the other label
(P3). And the "Visão geral" funnel dates sign-ups by `attributed_at`, i.e. the
click (`repositories/analytics.ts:477-483`), contradicting its own docstring and
the guide's "o funil conta o cadastro" (**A-3, P2**).

Anchors: 24 anchor pairs in `src/features/docs/structure.ts`, unique in both
locales, all rendered, all internal links resolve, `/pricing` resolves in both
locales. pt-br ↔ en: **zero key drift, zero rich-tag drift**; two harmless wording
differences where the en text is the more accurate one.

---

# Security

Good, and matching the guide:

- No secret reaches the browser: `server-only` on every secret module, a closed
  client env schema (`lib/env/client.ts:26-42`) and a test that fails the build if
  a secret ever appears in `NEXT_PUBLIC_*`
  (`lib/env/__tests__/no-secret-in-public-env.test.ts`).
- `logger.ts:17-37` redacts `authorization`, `key`, `key_hash`, `email` and any
  `sk_`/`pk_`/`whsec_` string at any depth. The only plaintext key printed
  anywhere is the seed script.
- API keys stored as peppered SHA-256, looked up by hash; webhook secrets
  AES-256-GCM; IPs and e-mails stored only as peppered hashes; URL credentials
  stripped before storage.
- `/api/identify` sends no CORS header and inherits the strict security headers;
  only `/t.js` is exempted.

Open items:

- **P1-2** cross-workspace subscription upsert (`schema/billing.ts:94`).
- **P1-3** legacy webhook route trusting a self-declared `acct_`.
- **I-2 / S-2** rate limiting before auth on a spoofable header, no limit at all
  on the webhook route, unbounded body read before verification.
- Click/attribution forgery: the publishable key is public and `/api/track`
  accepts any well-formed `visitorId`, so click counts can be inflated and — if
  an attacker learns a real visitor id before identify runs — a last-click
  attribution can be hijacked. After identify the renewal lock protects it.
- `HASH_PEPPER` is one global secret with no rotation path: rotating it
  invalidates every API key **and** every stored `email_hash`/`ip_hash`.
- The stored key `prefix` is six characters of the secret (display only).

---

# Tests

`pnpm lint`, `pnpm typecheck` clean; `pnpm test` = **434 passed, 92 skipped**.

Every `*.db.test.ts` is gated behind `RUN_DB_TESTS=1`, and this machine's
`.env.local` points at a remote Supabase instance, so **in a default run the
identify service, the ingest path, the webhook idempotency matrix and the
duplicate-payment proofs have no coverage at all**. They exist and they are
thorough — they simply do not run in CI as configured. That is the single biggest
structural risk in this report: the proofs behind the guide's strongest claims
are opt-in.

| Area | Verdict |
| --- | --- |
| Tracker script, visitor id helper, doc snippets ↔ schema/constants | TESTED (always run) |
| Commission math, reversals, disputes, hold, duration | TESTED (pure, always run) |
| Adapter normalisation, signature verification, webhook route codes | TESTED (always run) |
| Idempotency, duplicate payment, e-mail fallback, env isolation, key resolution, entitlements | TESTED but **gated** |
| `/api/track` and `/api/identify` error branches at HTTP level | UNTESTED |
| `rate-limit.ts`, `clientIp()` | UNTESTED |
| paused/unapproved click → `attributed:false` | UNTESTED |
| `via`/`aff` params, cookie flags, browser id generator | UNTESTED |
| `upsertSubscription` / `cancelSubscription` | UNTESTED |
| Legacy `/api/webhooks/stripe` | UNTESTED |
| TS ↔ SQL parity of the effective-status rule | UNTESTED |
| Program limit parity (DB check ↔ Zod ↔ form) | UNTESTED |
| Status-label parity across the four catalogues | UNTESTED |
| Docs anchors uniqueness / coverage | UNTESTED |

---

# Documentation-only issues

Safe to fix without any product decision (code is the source of truth):

1. `errors…invalid_ref.cause` — first character must be alphanumeric; uppercase is
   accepted and lowercased; ≥65 characters is `invalid_payload`.
2. `errors…invalid_visitor.cause/fix` — only a hand-made POST reaches it.
3. `errors…rate_limited.cause` (both routes) — short bursts are tolerated.
4. `apiKeys.publishable.uses.clicks` — it records clicks **and attributions**.
5. `installTracker.details.cookie` — `data-cookie-domain`, and ITP shortening.
6. `identifyCustomer.visitorIdBody` — subdomain case needs `data-cookie-domain`.
7. `identifyCustomer.securityBody` — accurate CORS wording.
8. `fields.providerCustomerId` — the `cus_` format is not validated.
9. `fields.provider` — a non-`stripe` provider is stored and never matched.
10. `identifyCustomer.stripeIdBody` — send the e-mail when identify runs before
    the Stripe customer exists; `receipt_email` only helps a payment that has a
    customer; a drop still answers `200`.
11. `commission.units.rounding` — "nunca ponto flutuante" is false for the
    percentage path.
12. `commission.units.fixed` — the fixed amount is not capped by the payment.
13. `commission.lifecycle.reversed` / `webhookEvents.types.disputeWon` —
    restoration is conditional; the hold restarts at the dispute-close date;
    `warning_closed` counts; `lost` does nothing.
14. `connectStripe.notes.currency` — the payment **is** recorded, without a
    commission.
15. `connectStripe.expected.ok/check` — the real badge strings.
16. `connectStripe.steps.events.body` — `invoice_payment.paid` is mandatory.
17. `attribution.firstClickBody` — B's click is recorded; after the window closes
    the next click opens a new attribution, in both models.
18. `attribution.lead` — one payment earns one commission even across programs.
19. `environments.rows.plan.live` / `goLive.plan.body` — trial counts, grace is 7
    days.
20. `goLive.program.body` — no approval step; the settings-copy shortcut exists.
21. `prerequisites.items.program` — the product site is optional.
22. `ERROR_GROUPS` (track) — 204 before 404, to match the route's real order.
23. `DATABASE.md:168` and `schema/ledger.ts:53` — `eligible_at` is derived from
    the **payment date**, not `created_at`.

# Implementation-only issues

Code is wrong or risky; the guide says nothing wrong. Not fixed here.

1. **P1-2** `subscriptions_provider_key` needs `workspace_id`.
2. **P1-3** delete or harden the legacy `/api/webhooks/stripe`.
3. **W-1** wrap from the claim onward so a throw marks the event `failed`.
4. **W-2** add `workspace_id` to the `customer_billing` claim key.
5. **A-3** the funnel should date sign-ups by the binding, not the click.
6. **P-1** a `BEFORE UPDATE` trigger on `programs.environment`.
7. `applyBasisPoints` overflow guard; complete the zero-decimal currency table.
8. Bearer scheme should be matched case-insensitively.
9. `/api/webhooks/stripe/[id]`: body size cap + rate limit.
10. Rate limiter: shared store, key by API key, stop trusting `x-forwarded-for`
    blindly, stop wiping the whole map at 20 000 keys.
11. Tracker: wrap `decodeURIComponent` in try/catch; delete the dead
    `generateVisitorId` and the dead `sendBeacon` fallback.
12. `StatusBadge` fallback renders a commission as "Aprovada".
13. Partial unique index for one active key per (type, environment).

# Product decisions required

### D1 · identify vs. a webhook-created customer (P1-1)
- DOCUMENTED_BEHAVIOR: call identify again with the `providerCustomerId`; repeating is safe.
- CURRENT_BEHAVIOR: the id is silently dropped when another row owns it; `200 {ok:true}`; commissions never materialise.
- IMPACT: silent, unrecoverable commission loss on a flow the guide recommends.
- RECOMMENDATION: merge the two customer rows (move ledger references onto the identified one), or answer `409 conflict`. Doc mitigation already applied.

### D2 · `invoice_payment.paid` is load-bearing (C-1, P2)
- DOCUMENTED_BEHAVIOR: select these ten events; redeliveries never duplicate a commission.
- CURRENT_BEHAVIOR: without the link event, a subscription payment recorded by both `payment_intent.succeeded` and `invoice.paid` earns two commissions, permanently.
- IMPACT: double payout, silent.
- RECOMMENDATION: detect "recorded twice, no link event within N hours" and surface it on Integrações, or drop `payment_intent.succeeded` from the recommended set. Doc mitigation applied.

### D3 · a batched partial reversal is never settled (M-1, P2)
- DOCUMENTED_BEHAVIOR: a full refund marks the original `reversed`; nothing is deleted.
- CURRENT_BEHAVIOR: a prior partial reversal already claimed by a batch stays `approved` and keeps deducting after the original is fully reversed.
- IMPACT: the affiliate is under-paid; narrow but silent.
- RECOMMENDATION: extend the settle set to `approved` and recompute the holding batch, or refuse to batch a reversal whose original is not in the same batch. Encode the chosen rule as a DB test **before** touching `applyReversalPlan`.

### D4 · a paused program keeps paying (A-1, P2)
- DOCUMENTED_BEHAVIOR: "programa ativo" frames attribution; suspension is presented as stopping commissions.
- CURRENT_BEHAVIOR: `recordPayment` never checks `program.status`; only the participation's approval gates the money.
- IMPACT: founders pause a program expecting payouts to stop.
- RECOMMENDATION: gate on the program status, or document it. Not documented here, pending the decision.

### D5 · what "first payment" means (P2)
- DOCUMENTED_BEHAVIOR: the window gates "o primeiro pagamento".
- CURRENT_BEHAVIOR: it gates the first payment that *earns a commission*; a payment skipped for currency or approval does not consume the window, and a first payment outside it blocks every renewal forever.
- RECOMMENDATION: confirm the semantics, then align the wording. No code change if intended.

### D6 · error-code casing (P3)
- Two vocabularies in one field, shared with the dashboard's own contract.
- RECOMMENDATION: normalise at the route boundary (`LIVE_MODE_REQUIRED` → `live_mode_required` on the wire, internal code unchanged) **before** external clients exist, or accept the split and say so in `errors.lead`. Doing it later is a breaking change.

### D7 · `rejected` commission status (P3)
- A status three catalogues label, filters offer, and no code can produce.
- RECOMMENDATION: ship a "recusar comissão" action and document it, or hide the labels and filters.

### D8 · Safari/ITP and the 365-day cookie (T-1, P2)
- RECOMMENDATION: decide whether a first-party proxy for the cookie is worth it; until then the guide warns about the shortening.

### D9 · click deduplication (P3)
- Every reload with `?ref=` counts a click. Decide whether to dedupe per
  (participation, visitor) within a window.

---

# Preventing drift

What already works and should be extended, rather than a restructure:

- The guide's event table, error numbers, tracker facts and commission example are
  **generated from the code's own constants** (`STRIPE_HANDLED_EVENTS`,
  `IDENTIFY_RATE_LIMIT`, `REF_QUERY_PARAMS`, `applyBasisPoints`), and
  `snippets.test.ts` pins the generated list to the adapter's `switch` and the
  sample body to the real Zod schema. This is the pattern; four cheap additions
  would close most of the remaining drift surface:
  1. a status-label parity test across `docs.commission.states`,
     `dashboard.commissions.statusLabel`, `portal.commissions.status`, `status.*`;
  2. a limits parity test (DB check ↔ Zod ↔ form `min`/`max`) for window, hold and
     duration;
  3. an anchors test (uniqueness per locale, every structure key rendered);
  4. an error-code registry: one module exporting `{ code, status, route }`,
     imported by the routes **and** by `ERROR_GROUPS` in `docs/page.tsx`, so a new
     code cannot exist undocumented.
- Run the `*.db.test.ts` suite in CI against a disposable Postgres. Today the
  guide's strongest claims are proven by tests nobody runs.

---

# Conformance matrix

| Area | Docs | Implementation | Status | Severity |
| --- | --- | --- | --- | --- |
| Tracker path / tag | `/t.js`, `data-key` | `TRACKER_PATH`, `getAttribute("data-key")` | MATCH | — |
| Referral params | `ref`, `via`, `aff` | same, first non-empty wins | MATCH | — |
| Referral code format | 2–49, letters/digits/`-`/`_` | must start alphanumeric; uppercase lowercased | DOC_WRONG | P3 |
| Tracker cookie | `_referral_id`, 365 days, Lax, Secure | same `Max-Age`; Safari/ITP caps at 7 days | DOC_WRONG (in practice) | P2 |
| Subdomain cookie | not mentioned | `data-cookie-domain` exists | DOC gap | P2 |
| visitorId format | `v_` + 16–48 | browser 24, server accepts 16–48 | MATCH | — |
| Track rate limit | 60/min/IP | token bucket, per instance, burst ≈2× | IMPLEMENTATION_DIVERGED | P4 |
| Track statuses | 200/204/400/401/404/429/500 | all reachable; 204 checked before 404 | MATCH (order) | P4 |
| `attributed:false` | paused / unapproved | same | MATCH | — |
| `attributed:true` meaning | implies credit | also true when another affiliate keeps it | DOC gap | P3 |
| Publishable key powers | "não altera dados" | creates/reassigns attributions | DOC_WRONG | P3 |
| Identify endpoint / auth | `POST`, Bearer secret only | same, scheme case-sensitive | MATCH / DIVERGED | P3 |
| Identify CORS | "não responde ao navegador" | no CORS headers; `OPTIONS` answers 204 | DOC_WRONG | P3 |
| Identify fields | 5 fields, types, limits | Zod schema identical | MATCH | — |
| `providerCustomerId` format | `cus_…` | not validated | DOC_WRONG | P4 |
| `provider` non-stripe | "único integrado" | accepted, never matched | IMPLEMENTATION_DIVERGED | P3 |
| Identify response | `ok`, `customerId`, `attributionsBound` | same semantics | MATCH | — |
| Identify idempotency | safe, nothing erased | true; provider-id conflict silently ignored | IMPLEMENTATION_DIVERGED | P1 |
| Identify rate limit | 120/min/IP + `Retry-After` | same, per instance, pre-auth | MATCH / P2 risk | P2 |
| Customer matching | provider id → e-mail → none | same; no customer ⇒ not recorded | MATCH | — |
| Payment drop visibility | not mentioned | answers `200`; only Integrações shows it | DOC gap | P2 |
| Stripe setup | no OAuth, account id + secret | same | MATCH | — |
| `acct_` id use | implied meaningful | display-only in the founder flow | DEAD_IMPLEMENTATION | P3 |
| Webhook URL | `/api/webhooks/stripe/<id>` | same, uuid-validated | MATCH | — |
| Two secrets / `livemode` | one URL, one endpoint per mode | verified against both, mismatch 400 | MATCH | — |
| Stripe events (10) | list + behaviour | all real, all handled | MATCH | — |
| `charge.dispute.closed` | "disputa vencida" | also `warning_closed`; `lost` ignored | DOC incomplete | P4 |
| `invoice_payment.paid` | "liga a fatura" | mandatory to prevent double commission | DOC gap | P2 |
| Redelivery idempotency | never duplicates | proven (event id + money keys + locks) | MATCH | — |
| Failed event retry | 500 → Stripe retries → reprocessed | same | MATCH | — |
| Crash between claim and try | not mentioned | event lost for 10 min window | IMPLEMENTATION_DIVERGED | P2 |
| Claim key scope | not mentioned | no `workspace_id` → two workspaces clash | IMPLEMENTATION_DIVERGED | P2 |
| Currency rule | "ignora pagamentos em USD" | payment recorded, commission skipped | DOC_WRONG | P4 |
| Commission formula | bps, minor units, half-up | exact half-up away from zero | MATCH | — |
| "nunca ponto flutuante" | absolute | float division in the percentage path | DOC_WRONG | P3 |
| Overflow / zero-decimal | not mentioned | no guard; 8 currencies missing | IMPLEMENTATION_MISSING | P3 |
| Fixed amount | per payment | not capped by the payment | DOC gap | P3 |
| Custom affiliate rate | overrides the program | overrides value **and** type | MATCH | — |
| Commission conditions | 5 conditions | identical | MATCH | — |
| Duration / renewals | first only / N months / lifetime | same, anchored on the first commissioned payment | MATCH | — |
| Attribution window | 1–365, default 60, from the click | DB, Zod and form all agree | MATCH | — |
| Hold period | 0–180, default 30, from the payment | same (internal docs say `created_at`) | MATCH | — |
| `pending → available` | on hold expiry | computed from the clock, no cron | MATCH | — |
| First click | A keeps credit | same; B's click updates `last_click_id` | DOC_WRONG (minor) | P4 |
| Last click | B takes credit, window restarts | same, row updated in place | MATCH | — |
| After the window expires | silent | any click re-opens, both models | DOC gap | P2 |
| Renewal lock | credit never moves after identify | same | MATCH | — |
| Paused program | stops attributions | also implied to stop commissions; it does not | IMPLEMENTATION_DIVERGED | P2 |
| Refunds | proportional, cumulative, nothing deleted | same | MATCH | — |
| Paid commission | never clawed back | same | MATCH | — |
| Batched partial reversal | settles on full refund | stays `approved`, keeps deducting | IMPLEMENTATION_DIVERGED | P2 |
| Dispute won | "o valor revertido volta" | conditional; new hold from the close date | DOC_WRONG | P3 |
| Commission states | 5 states | all exist; `rejected` unreachable but labelled | DEAD_IMPLEMENTATION | P3 |
| Program environment | immutable, never converts | service-enforced only, no DB guard | IMPLEMENTATION_MISSING | P2 |
| "Ir para produção" | create a live program | correct; settings-copy shortcut undocumented | MATCH / DOC gap | P3 |
| "aprove os afiliados nele" | approval step | founder enrolment auto-approves | DOC_WRONG | P3 |
| Live mode gating | Launch or Growth | + trial + 7-day grace (+ non-public Scale) | DOC incomplete | P3 |
| Without live mode | 204 / 402 / acknowledged | same | MATCH | — |
| API keys | 4 prefixes, hashed, once, rotation kills old | same | MATCH | — |
| One active key per (type, env) | implied | no unique index | IMPLEMENTATION_MISSING | P4 |
| Secret key never in the browser | absolute | enforced and tested | MATCH | — |
| Error codes | 24 documented | all reachable; 4 undocumented responses | MATCH / DOC gap | P3 |
| Error-code casing | mixed, as implemented | intentional (shared with the dashboard) | UNCLEAR | P3 |
| UI labels | 23 references | 20 verbatim, 3 diverge | DOC_WRONG | P3 |
| Funnel "Cadastros" | counts the sign-up | dated by the click | IMPLEMENTATION_DIVERGED | P2 |
| pt-br ↔ en | parity | zero key and tag drift | MATCH | — |
