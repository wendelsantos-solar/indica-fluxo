# UNIVERSAL_ATTRIBUTION_ARCHITECTURE.md

**Integrate once. Connect every provider your SaaS charges through.**

Design for "Universal attribution + N billing connectors". Builds on
`INTEGRATION_ARCHITECTURE_V2.md` (token + bridge), evidence in
`MULTI_PROVIDER_INTEGRATION_AUDIT.md` and `BILLING_PROVIDER_MATRIX.md`.

The question every decision below answered:

> Does this make the founder integrate the product once, or each provider
> separately?

---

## 1. Shape

```
                          THE PRODUCT (installed once)
  Website / SaaS
     │  <script src="/t.js">              → click, attribution, ifx_ token
     │  POST /api/identify (server)       → Customer (their own user id)
     │  checkoutFields(provider, …)       → one helper, provider-native fields
     ▼
  Attribution ──► Customer ──► BillingIdentity[] ──► BillingConnection[]
                                                        │
        ┌───────────────┬───────────────┬───────────────┤
     Stripe         Mercado Pago     AbacatePay        Asaas         (plugins)
        └───────────────┴───────┬───────┴───────────────┘
                                ▼
                     NormalizedBillingEvent[]      ← the only thing the core sees
                                ▼
                 Customer → Attribution → Transaction → calculateCommission()
```

`calculateCommission` is unchanged and still receives nothing new. Every
change lands above `transactions`.

## 2. Entities

| Entity | Table | Key | Notes |
| --- | --- | --- | --- |
| Visitor | (cookie `_referral_id`) | `visitor_id` | browser identity, never sent to a provider |
| Attribution | `attributions` | `(program, visitor)` | unchanged |
| AttributionToken | `attribution_tokens` | `token_hash` | unchanged: `ifx_` + 43 base64url, peppered hash, workspace + environment scoped, expires with the window, first bind wins |
| **Customer** | `customers` | `(workspace, env, external_id)` | the SaaS's own customer. May exist before any provider sees it (Customer-first) |
| **BillingIdentity** (new) | `billing_identities` | `(workspace, env, provider, provider_customer_id)` | "this Stripe `cus_…` / this MP payer / this Asaas `cus_…` is that Customer". N per customer |
| **BillingConnection** | `integrations` (evolved) | `(workspace, provider, provider_account_id)` | a merchant account. N per workspace, N per provider |
| Transaction / Commission | unchanged | unchanged | ledger untouched |

### Why `provider_account_id` is *not* in the identity key

Evaluated (brief §47). The identity key is `(workspace, environment, provider,
provider_customer_id)`:

- the four providers' customer ids are provider-issued, prefixed, global ids
  (`cus_…`, `cust_…`, `cus_…`, MP user ids are MP-wide user numbers) — two
  accounts of the same provider cannot mint the same id for different people;
- Stripe per-workspace endpoints do not carry `event.account`, so the account
  is not always known at resolution time — keying on it would split one
  customer into two;
- the connection that first saw the identity is recorded (`integration_id`) for
  provenance and diagnostics.

Provider is always part of the key: Stripe `"123"` and Mercado Pago `"123"` are
two identities (tested).

### Customers are never merged by e-mail

E-mail stays an auxiliary signal with the existing rule (exactly one identified
customer with that hash, same provider, else nothing). The canonical link is the
SaaS's own `externalCustomerId`.

## 3. Customer identity — two flows, one ledger

### Flow A — Customer-first (recommended)

```
click → /t.js → attribution + ifx_ token (cookie)
signup → POST /api/identify { visitorId, externalId }            ← server, secret key
       → customers(external_id) ; attributions.customer_external_id
checkout (any provider) → checkoutFields(provider, { token, customerId: externalId })
webhook → BillingIdentity(provider customer → Customer) → attribution → commission
renewal / other provider → same Customer → same attribution
```

`/api/identify` is the universal server-side identity API (brief §6). It
already requires a **secret key** — a browser-supplied id is never trusted — and
its contract is unchanged except `provider` accepting the new ids. Optional
`provider` + `providerCustomerId` write a BillingIdentity directly for SaaS that
create the provider customer themselves.

The id sent is the SaaS's own stable user id: tenant-scoped (unique per
workspace + environment), never shown to affiliates, and it never travels in a
public token. CPF, e-mail, phone and name are never put in a token or a provider
reference (e-mail is accepted by identify only to hash it).

### Flow B — Checkout-first (fallback: guest checkout, landing → checkout)

```
click → ifx_ token → checkoutFields(provider, { token }) → provider field
webhook → token → visitor → attribution → Customer (created from the provider customer)
```

Flow B is never required when Flow A already resolved the customer.

### How a provider payment finds its Customer (resolution order)

`resolveCustomer` in `billing-events.ts`, deterministic:

1. **BillingIdentity** `(workspace, env, provider, provider_customer_id)` → customer.
2. Legacy `customers (provider, provider_customer_id)` → customer (and a
   BillingIdentity is written — lazy backfill).
3. **`externalCustomerId` on the event** (server-set metadata only) →
   `customers.external_id` → customer; BillingIdentity written.
4. **Token on the event** → bridge → visitor → the visitor's attributions carry
   `customer_external_id` (Flow A happened) → that customer; BillingIdentity
   written. *This is what makes a provider switch keep the attribution without
   the SaaS doing anything new.*
5. E-mail hash rule (unchanged).
6. New customer row for the provider id (unchanged), BillingIdentity written.

Then `commissionForTransaction` finds the attribution by the provider customer
id **or** the customer's external id (unchanged).

### Provider switch (brief §51) and multi-provider customers (§52)

```
Customer 42 ── Stripe cus_A  ──► invoice.paid  ─┐
            └─ MP payer 9001 ──► payment approved ─┴─► same customer 42
                                                     ─► same attribution
                                                     ─► same affiliate
```

The MP identity reaches customer 42 through step 3 (`externalCustomerId`) or
step 4 (token whose visitor was identified as 42). Both are DB-tested.

**What "keeps the attribution" means — and does not.** The switch keeps the
same *customer* and the same *attribution*; it does not grant anything the
program's rules would not (verified in `commission-writer.ts` /
`domain/commission.ts`, 2026-09-18):

- attribution window: checked only on the first commissioned payment;
- commission duration: counted from the first commissioned payment of that
  customer + participation, on any provider — a switch does not restart it;
- participation must be `approved` at payment time (`AFFILIATE_INACTIVE`);
- currency must match the program (`CURRENCY_MISMATCH`);
- environment: a payment only reaches programs of its environment;
- first/last click decides the affiliate at click time, not at payment;
- program status is **not** checked at payment time: a paused/archived program
  stops creating attributions from clicks (`recordClick`), but payments of
  customers already attributed keep earning within the rules above.

There is no "affiliate forever" rule: `commission_duration_months = NULL`
(lifetime) is the only case with no end, and it is the program's own setting.

## 4. Universal Checkout Bridge

The founder learns **one** API. The product decides which provider field
carries it.

```ts
// Server-side, where the checkout is created. `token` = the `_referral_ref`
// cookie (or window.Referral.attributionToken); `customerId` = your user id.
const fields = checkoutFields("mercado_pago", { token, customerId })
mercadopago.preference.create({ ...yourPayload, ...fields })
```

Implemented as a pure function in `src/lib/billing/checkout-bridge.ts`
(provider-native mapping, unit-tested, rendered verbatim in the in-product
guide):

| Provider | `token` goes to | `customerId` goes to |
| --- | --- | --- |
| `stripe` (Checkout Session) | `client_reference_id`, `metadata.indicafluxo_ref` | `metadata.indicafluxo_customer` |
| `mercado_pago` (preference / payment) | `external_reference` | `metadata.indicafluxo_customer` (+ `metadata.indicafluxo_ref`) |
| `abacatepay` (checkout) | `externalId` | — (metadata is not echoed in webhooks: identify instead) |
| `asaas` (payment / subscription) | `externalReference` | — (no metadata: identify instead) |

Where a provider cannot carry the customer id, the bridge says so (`customer:
"identify"`) and the guide tells the founder that `/api/identify` covers it —
the limitation is shown, not hidden (brief §10).

Legacy names are kept: `ifx_` prefix, `indicafluxo_ref`, `_referral_ref`,
`/api/identify` (brief §76). No identifier is renamed for branding.

## 5. Connector port

```ts
// src/lib/billing/connector.ts
interface BillingConnector {
  readonly provider: BillingProviderId
  /** Throws WebhookAuthError before anything is parsed. */
  verify(delivery: WebhookDelivery, credentials: unknown): Promise<VerifiedWebhook>
  /** Async (MP fetches the payment); may yield several facts (payment + refund). */
  normalize(verified: VerifiedWebhook, context: NormalizeContext): Promise<NormalizedBillingEvent[]>
  /** Validates the credential and, when the provider allows, registers the webhook. */
  connect?(input: ConnectInput, http: HttpClient): Promise<ConnectResult>
  disconnect?(credentials: unknown, http: HttpClient): Promise<void>
}
```

Capabilities are **data**, not methods (`src/lib/billing/catalog.ts`, pure and
client-safe): `oauth`, `apiKey`, `automaticWebhook`, `subscriptions`,
`partialRefunds`, `refunds`, `disputes`, `disputeWon`, `failedPayments`,
`multiAccount`, `testMode`, plus `connectionMethod`, `setupSteps` and
`availability` (`public` / `beta` / `coming_soon`). The UI renders the table
from it; a "—" is shown, never hidden (brief §67).

Stripe keeps `StripeAdapter` (`BillingProvider`) and its two routes — its
contract predates this port and every existing integration depends on it; a
Stripe entry in the catalog describes it.

### Availability flags

`BILLING_CONNECTORS_DISABLED=mercado_pago,asaas` (server env) turns a beta
connector into `coming_soon`: its card shows "Em breve", its connect button is
not rendered, its connect action refuses, and its webhook route answers 404.
Defaults: Stripe `public`; Mercado Pago, AbacatePay, Asaas `beta`.

## 6. Normalized event (additive)

```ts
type BillingProviderId = "stripe" | "paddle" | "manual" | "mercado_pago" | "abacatepay" | "asaas"

PaymentSucceededEvent  + externalCustomerId?: string | null
PaymentRefundedEvent   + cumulativeRefundedMinor?: number   // MP, Asaas, AbacatePay
SubscriptionUpdated    + externalCustomerId?: string | null
+ PaymentFailedEvent   { type: "payment.failed"; providerTransactionId; providerCustomerId; reason }
```

`cumulativeRefundedMinor`: the provider reports the running refunded total, not
the refund. The core records `delta = cumulative − already recorded` under
`<payment>:refund:<cumulative>` — idempotent by construction, and the adapter
stays stateless (no financial logic in adapters, brief §49).

`payment.failed` moves no money and creates no transaction; it is recorded on
the event row for diagnostics.

## 7. Webhooks, routing, idempotency

| Route | Who | Verified by |
| --- | --- | --- |
| `/api/webhooks/stripe/[integrationId]` | Stripe, founder endpoint | endpoint `whsec_` (unchanged) |
| `/api/webhooks/stripe` | Stripe Connect / CLI | platform secret, routed by `event.account` (unchanged) |
| **`/api/webhooks/billing/[provider]/[integrationId]`** | Mercado Pago, AbacatePay, Asaas | the connection's own secret, via its connector |

Order (ARCHITECTURE.md §3.3, unchanged): raw body → load connection by id **and**
provider (unknown = 404, indistinguishable) → verify → environment check →
claim → normalize → process → mark → respond. Pre-verification failures never
say why. AbacatePay never receives `410` (it would disable the webhook).

Idempotency key: `webhook_events (scope, provider, provider_event_id)` unchanged.
For Stripe the event id is used as is (globally unique, documented); for every
other provider it is claimed as **`<integration_id>:<provider event id>`**
because no other provider documents global uniqueness (brief §13). Money has
its own barrier: `transactions (workspace, provider, provider_transaction_id)`.

`webhook_events` gains `integration_id` and `reason_code`.

## 8. Event states and reasons

Stored status stays `received → processed | ignored | failed` (+ `duplicate`
is the claim refusing). `verified` and `normalized` are not persisted states:
an unverified delivery is never claimed (it is counted on the connection as a
rejection), and normalization failure is `failed` with a reason.

Closed reason list (`src/lib/billing/reasons.ts`), written to
`webhook_events.reason_code`:

```
NO_ATTRIBUTION  ATTRIBUTION_EXPIRED  AFFILIATE_INACTIVE  RECURRENCE_WINDOW_CLOSED
CURRENCY_MISMATCH  ZERO_AMOUNT  CUSTOMER_NOT_LINKED  TEST_LIVE_MISMATCH
DUPLICATE_EVENT  UNSUPPORTED_EVENT  LIVE_MODE_INACTIVE  NO_CONNECTION
TOKEN_UNKNOWN  TOKEN_EXPIRED  TOKEN_CONFLICT  PAYMENT_NOT_RECORDED_YET
PAYMENT_FAILED  PROCESSING_ERROR
```

(`PROGRAM_INACTIVE` from the brief is not emitted: the engine does not gate on
program status today and this phase does not change engine behaviour.)

## 9. Health

Per connection, derived deterministically (`src/features/integrations/health.ts`,
pure, tested):

| Stage | healthy | warning | error | unknown |
| --- | --- | --- | --- | --- |
| AUTH | credential saved / OAuth account | — | status `error` (auth failed) | pending |
| WEBHOOK | event ≤ 7 d, no rejection since | no event yet / > 7 d quiet | signature rejected after setup / last event failed | not set up |
| EVENT_NORMALIZATION | events processed | some `UNSUPPORTED_EVENT` | processing failures | no events |
| CUSTOMER_MATCHING | payments have customers | — | payments dropped (`CUSTOMER_NOT_LINKED`) | no payments |
| ATTRIBUTION | ≥ 1 attributed payment, or no expected-attributed misses | — | expected-attributed payment without commission | no payments |
| COMMISSION | commissions created | — | — | none yet |

Overall: `NOT_CONNECTED`, `CONNECTING` (pending/awaiting first event),
`HEALTHY`, `DEGRADED` (any warning), `ACTION_REQUIRED` (error the founder can fix:
auth, signature, dropped payments), `ERROR` (processing failures).

**Organic payments never alert.** "Expected attributed payment without
commission" = a payment whose customer has a bound attribution in that
environment and still no commission. That, and only that, is a warning.

## 10. Security

- Credentials: AES-256-GCM (`encryptSecret`) in `integrations.encrypted_credentials`,
  zod-parsed on the way out (malformed fails closed), never returned to the
  browser, never logged, dropped on disconnect. The UI claim "encrypted and
  never shown again" is true in code.
- Per-connection webhook secrets are generated by us (32 random bytes) for
  Asaas and AbacatePay; compared with `timingSafeEqual`.
- Same credential twice in one workspace is refused (peppered fingerprint in
  `metadata.credentialFingerprint`, never the key).
- Only the connector talks to its fixed API host; nothing follows a URL from a
  payload.
- Connect/disconnect/credentials: `owner`/`admin` (`requireMembership(…, "admin")`),
  members read status, affiliates nothing. RLS: `billing_identities` member
  `SELECT` only, no client write path; `integrations` unchanged.
- Audit: `integration.connected`, `integration.disconnected`,
  `integration.credentials_updated`, `integration.webhook_registered`,
  `integration.webhook_failed` — metadata carries provider and connection id,
  never a secret.

## 11. What was deliberately not built

- No queue, worker, Kafka or Temporal. Webhook processing stays synchronous and
  idempotent; Mercado Pago's single fetch fits inside its 22-second budget.
- No Mercado Pago OAuth (needs a platform MP application; designed, not wired).
- No e-mail merge, no fuzzy matching.
- No rename of `integrations` to `billing_connections` (name not user-facing;
  rename would break every query for no behaviour).
- No public docs or SEO pages for beta providers (brief §71, §72).
