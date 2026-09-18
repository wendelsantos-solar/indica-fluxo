# MULTI_PROVIDER_IMPLEMENTATION_REPORT.md

Universal attribution + N billing connectors — what was built, how it was
verified, and what is still open. Date: 2026-09-18.

Read in order: `MULTI_PROVIDER_INTEGRATION_AUDIT.md` (phase 0) →
`BILLING_PROVIDER_MATRIX.md` (provider research, official docs) →
`UNIVERSAL_ATTRIBUTION_ARCHITECTURE.md` (design) → `MULTI_PROVIDER_UX_SPEC.md`
(screens) → this report.

---

## FILES_CHANGED

**New — billing core (`src/lib/billing/`)**
`catalog.ts` (connectors as data: capabilities, availability, connection method) ·
`connector.ts` (`BillingConnector` port, errors) · `connectors.ts` (registry) ·
`checkout-bridge.ts` (`checkoutFields`) · `reasons.ts` (closed reason codes) ·
`identity-key.ts` · `mercado-pago/connector.ts` · `abacatepay/connector.ts` ·
`asaas/connector.ts` · `__fixtures__/providers.ts` (sanitized payloads) ·
`__tests__/connector-contract.test.ts`, `__tests__/universal.test.ts`

**New — services**
`server/services/billing-connections.ts` (list, connect API-key providers,
Mercado Pago secret step, disconnect, rename, selection, ingest-side reads) ·
`server/services/billing-identity.ts` (the one writer of `billing_identities`) ·
`server/services/connection-health.ts` (per-connection evidence, diagnostics
pipeline, recent events) · `__tests__/multi-provider.db.test.ts`

**New — routes and UI**
`app/api/webhooks/billing/[provider]/[integrationId]/route.ts` (+ route test) ·
`app/[locale]/(dashboard)/[workspaceSlug]/integrations/[connectionId]/page.tsx` ·
`features/integrations/`: `health.ts`, `setup.ts` (pure, tested), `health-view.tsx`,
`connection-card.tsx`, `integration-tabs.tsx`, `add-provider-dialog.tsx`,
`provider-selection.tsx`, `connection-manage.tsx`, `connection-actions.ts`,
`checkout-bridge-section.tsx`, `bridge-snippets.ts`, `provider-mark.tsx`,
`auto-refresh.tsx`

**Modified**
`lib/billing/types.ts` (provider ids, additive event fields, `payment.failed`) ·
`lib/billing/stripe/adapter.ts` (`externalCustomerId` from metadata; bind without
token) · `lib/money.ts` (`decimalToMinor`) · `lib/logger.ts` (new secret shapes
redacted) · `lib/tracking/attribution-token.ts` (`indicafluxo_customer`) ·
`lib/api/contract.ts` (identify `provider` enum) · `server/services/billing-events.ts`
(generic ingest, identity-first resolution, cumulative refunds, guest identity,
reason codes, connection context) · `attribution-bridge.ts` (customer-first
linking, namespaced keys) · `commission-writer.ts` (provider-aware key, reason
codes, structured log) · `identify.ts` (N identities) · `integrations.ts`
(Stripe by connection id, multi-account) · `stripe-connect.ts` (upsert per
account) · `integration-health.ts` (any provider for the checklist) ·
`webhook-events.ts` repository · `audit.ts` (6 actions) · Stripe webhook routes
(pass the connection) · `integrations/page.tsx` (tabs) · `stripe-panel.tsx`
(scoped to a connection) · `actions.ts` · `activation-checklist.tsx` (links) ·
`i18n/routing.ts` · both catalogues · schema files · `.env.example` ·
`ARCHITECTURE.md`, `DATABASE.md`, `DESIGN.md`

**Removed**: `features/integrations/integrations-aside.tsx` (replaced by the
Overview tab; no remaining import).

## MIGRATIONS

`0018_billing_connections.sql` (registered in `meta/_journal.json`, applied to
the development database with `pnpm db:migrate`). Additive; rollback steps are in
the file header. New enum values are added but never used in the same
migration (the Drizzle migrator runs pending files in one transaction).

The pending, pre-existing `0017_workspace_acquisition` was also applied to the
development database first — the test baseline could not run without it.

## NEW_TABLES

| Table | Purpose | RLS |
| --- | --- | --- |
| `billing_identities` | one customer ↔ N provider customer ids | member SELECT; no client write |
| `billing_setup_selections` | "how do you get paid?" multi-select | member SELECT; owner/admin write |

Plus SECURITY DEFINER `billing_connection_events(ws, since)` and
`billing_connection_recent_events(ws, connection, limit)`.

## MODIFIED_TABLES

| Table | Change |
| --- | --- |
| `integrations` | + `display_name`, `environment`, `last_verified_at`, `status_reason`; `UNIQUE (workspace, provider)` → `UNIQUE (workspace, provider, provider_account_id) WHERE account IS NOT NULL`; + index `(workspace, created_at)`; status + `pending` |
| `webhook_events` | + `integration_id` (FK SET NULL), `reason_code`; + index `(integration_id, received_at desc)` |
| `transactions` | + `integration_id` (FK SET NULL), written once at insert |
| enum `billing_provider` | + `mercado_pago`, `abacatepay`, `asaas` |
| enum `integration_status` | + `pending` |

Backfill: `billing_identities` 1:1 from `customers.provider_customer_id` (in the
migration). No ledger row rewritten.

## PROVIDER_CONNECTORS

| Provider | Connect | Webhook | Verify | Normalize | Status |
| --- | --- | --- | --- | --- | --- |
| Stripe | Connect OAuth (with `STRIPE_CONNECT_CLIENT_ID`) or `acct_` + endpoint `whsec_` — unchanged, now per connection | platform Connect endpoint / per-connection endpoint | `Stripe-Signature` | existing adapter (+ `externalCustomerId`) | **public** |
| Mercado Pago | access token (validated on `/v1/payments/search`) → pending → signature secret from the panel | **manual** (no registration API documented): URL + 4 topics | `x-signature` HMAC of `id;request-id;ts;` | fetches `/v1/payments`, `/preapproval`, `/authorized_payments`, `/v1/chargebacks` with the merchant token; state-based; cumulative refunds; `charged_back`; `rejected` → failed | **beta** |
| AbacatePay | API key → `POST /v2/webhooks/create` with our secret | **automatic** | `?webhookSecret` (ours) **and** base64 HMAC with the published key | checkout/transparent completed/refunded/disputed, subscription completed/renewed/cancelled/trial, payment_failed | **beta** |
| Asaas | API key → `POST /v3/webhooks` with our `authToken`, `SEQUENTIALLY` | **automatic** (removed on disconnect) | `asaas-access-token` constant-time | CONFIRMED/RECEIVED (same `pay_` id), REFUNDED/PARTIALLY (cumulative), CHARGEBACK, OVERDUE/refused → failed, SUBSCRIPTION_* | **beta** |

Registry: `src/lib/billing/connectors.ts`. A fifth provider = one folder, one
registry line, one catalog entry, one `describeConnector(...)` in the contract
suite.

## PROVIDER_CAPABILITIES

Data in `src/lib/billing/catalog.ts`, rendered on each connection's page ("—"
when absent). Documented gaps surfaced, not hidden: AbacatePay has no partial
refund and no dispute-won; Mercado Pago cannot register webhooks by API and its
test credentials send no notifications; Asaas has no read-only key and no HMAC.

## WEBHOOKS

- New generic route `POST /api/webhooks/billing/[provider]/[integrationId]`;
  Stripe's two routes unchanged in contract.
- Verification before parsing; pre-auth failures are bare `404`; auth failure
  `401` + rejection time noted on the connection; never `410`.
- Idempotency: Stripe ids as before; every other provider's id claimed as
  `<connection>:<id>` (tested: the same provider id on two connections are two
  events; a redelivery is a duplicate). Money still has its own
  `UNIQUE (workspace, provider, provider_transaction_id)`.
- Environment: connection environment vs event environment mismatch →
  `TEST_LIVE_MISMATCH`, nothing processed (tested).
- One delivery → N facts, each processed; the claim ends with the most
  important reason code.

## ATTRIBUTION_CHANGES

- The `ifx_` token is the universal checkout reference for every provider
  (fits MP's 64-char alphabet, Asaas `externalReference`, AbacatePay `externalId`).
- Customer-first: a token whose visitor was identified links the new provider
  identity to that customer — even when an earlier provider already bound the
  token. Otherwise first-bind-wins is unchanged (a forwarded link cannot credit
  a stranger — tested).
- `attributions.provider_customer_id` / `bound_provider_customer_id` keep Stripe
  ids bare, namespace other providers (`mercado_pago:123`).
- Guest checkout: a payment with no provider customer but a reference (or the
  SaaS's id) becomes its own identity (`guest:<payment id>`) and can earn.
- Commission engine: **unchanged**. `calculateCommission` receives nothing new.

## IDENTITY_CHANGES

- `billing_identities` (N per customer); resolution order: identity → legacy
  column → `externalCustomerId` from server-set metadata → e-mail rule → new.
- `POST /api/identify`: contract unchanged except `provider` accepts the new
  ids; writes an identity when `providerCustomerId` is given; never moves an
  identity owned by another customer; never merges by e-mail.
- Checkout bridge: `checkoutFields(provider, { token, customerId })`; the
  customer id travels only in metadata (Stripe, MP). AbacatePay/Asaas cannot
  echo metadata, so the bridge answers `customer: "identify"` and the guide says so.

## UI_CHANGES

Integrations → tabs Visão geral · Pagamentos · Rastreamento · API (sidebar
unchanged). Summary strip, setup checklist with auto-detection, multi-select
provider choice, connection cards grouped by provider with "Conectar outra
conta", add-provider dialog with search/availability/effort, API-key form with
show/hide, per-connection page (status, issues with inline fixes, stages,
payments pipeline, recent events, capabilities, advanced), Mercado Pago panel
step, rename, key rotation, disconnect with consequence. Stripe's existing setup
wizard now lives on each Stripe connection's page.

## UX_CHANGES

See `MULTI_PROVIDER_UX_SPEC.md`. Highlights: the founder picks "how do you get
paid" (multi-select), installs once (tracker + identify), connects each account
with an honest effort label; nothing turns green before the backend confirms;
errors say what happened / what it affects / what to do; organic payments never
alert; beta providers labelled; no timers or time claims.

## DIAGNOSTICS

- Health per connection: AUTH, WEBHOOK, EVENT_NORMALIZATION, CUSTOMER_MATCHING,
  ATTRIBUTION, COMMISSION → overall HEALTHY / DEGRADED / ACTION_REQUIRED / ERROR
  / CONNECTING / NOT_CONNECTED (`features/integrations/health.ts`, 9 tests).
- Payment pipeline per payment with classification commissioned / organic /
  **expected** (attributed customer, live attribution, no commission).
- Reason codes on every event (`NO_ATTRIBUTION`, `ATTRIBUTION_EXPIRED`,
  `AFFILIATE_INACTIVE`, `CUSTOMER_NOT_LINKED`, `TEST_LIVE_MISMATCH`,
  `UNSUPPORTED_EVENT`, `TOKEN_*`, `PAYMENT_FAILED`, …). `PROGRAM_INACTIVE` is not
  emitted: the engine does not gate on program status and this phase did not
  change engine behaviour.
- Structured logs carry workspaceId, integrationId, provider, eventId,
  normalizedEventType, reason, transactionId, customerId, attributionId,
  commissionId — no secret, no payload, no e-mail (logger redaction extended to
  `APP_USR-`, `TEST-`, `$aact_`, `abc_prod_/abc_dev_`, `x-signature`, …).

**Analytics / setup time (§73–74)**: no event platform added. The funnel is
derivable from timestamps the schema now holds:

```sql
-- signup → first real click → first identify → connect started/connected → first event
select w.created_at as signup,
       (select min(c.occurred_at) from referral_clicks c join programs p on p.id = c.program_id
         where p.workspace_id = w.id and c.visitor_id not like 'v_sim%') as tracker_detected,
       (select min(cu.created_at) from customers cu
         where cu.workspace_id = w.id and cu.external_id is not null and cu.external_id not like 'sim_%') as identity_detected,
       i.provider, (i.metadata->>'connectStartedAt')::timestamptz as connect_started, i.connected_at,
       (select min(e.received_at) from webhook_events e where e.integration_id = i.id) as first_event
  from workspaces w left join integrations i on i.workspace_id = w.id;
```

Admin actions are audited (`integration.connected / reconnected /
credentials_updated / webhook_registered / webhook_failed / disconnected /
renamed / providers_selected`).

## SECURITY

- Credentials: AES-256-GCM, zod-parsed on read (malformed fails closed), never
  returned, never logged, dropped on disconnect; same key twice refused via a
  peppered fingerprint. The UI claim "criptografada e nunca exibida de novo" is
  true in code.
- Per-connection secrets generated server-side (32 random bytes) for Asaas and
  AbacatePay; constant-time comparisons everywhere.
- Mercado Pago fetches only by the notified id, only from the fixed API host,
  only with that connection's token; a delivery for another account on a
  connection that knows its account is refused.
- `externalCustomerId` read only from server-set metadata, never from
  browser-settable fields.
- Rate limiting: `/api/track` and `/api/identify` unchanged. The webhook route
  does no per-IP limiting (providers retry from shared IPs); it rejects before
  any DB write except the throttled rejection timestamp (≤ 1/min/connection).

## RLS

`billing_identities` and `billing_setup_selections` RLS-enabled, `indica_app`
grants only; nothing for `anon`/`authenticated`. DB-tested: another workspace's
owner and an affiliate of the workspace read no connections, identities,
selections, connection events or recent events; a member cannot insert an
identity. **RLS=PASS**.

## TESTS

| Suite | Result |
| --- | --- |
| `RUN_DB_TESTS=1 pnpm exec vitest run` | **702 passed, 3 skipped, 67 files** (baseline was 621) |
| `pnpm test` (no DB) | 575 passed, 130 skipped |
| Connector contract suite (3 providers × 6 + specifics) | 41 |
| Domain matrix (`multi-provider.db.test.ts`, real Postgres) | 22: identify→Stripe, identify→MP, same customer Stripe+MP, provider switch by reference, guest checkout, no customer no reference, cumulative partial→full refund with reversal, duplicate event, unknown/organic customer, attribution expired, affiliate suspended (expected-without-commission), Stripe "123" vs MP "123", forwarded reference, renewal by identity, multi-account connect + webhook registration + duplicate key, refused key leaves nothing / member refused, event-id scoping + environment mismatch + duplicate, disconnect keeps ledger, selection + health, RLS isolation, diagnostics organic vs expected, wizard E2E |
| Generic webhook route | 5 |
| Health, setup, universal (bridge, money, catalog, keys, reasons) | 24 |

## E2E

Service-level E2E of the wizard (brief §80), on the real services and the real
webhook route handler with a mocked provider `fetch`: account → program →
affiliate → simulated conversion → choose Asaas + Mercado Pago → connect Asaas
(webhook registered with a generated token) → tracker click → identify → a
documented Asaas payload signed with that token through
`POST /api/webhooks/billing/asaas/<id>` → connection **healthy**, commission
created, transaction carries the connection id, setup **ready** with Mercado
Pago listed as optional. No real charge anywhere.

A browser E2E (Playwright) was not added: the project has no browser test
runner, and adding one was out of proportion (brief §83).

## LINT

`pnpm lint` — pass, 0 warnings.

## TYPECHECK

`pnpm typecheck` — pass (after `next typegen` for the new route).

## BUILD

`pnpm build` — pass; `/[locale]/[workspaceSlug]/integrations/[connectionId]` and
`/api/webhooks/billing/[provider]/[integrationId]` present.

## KNOWN_LIMITATIONS

1. **No beta connector has round-tripped against a real account.** They follow
   the official docs of 2026-09-18 and pass contract tests on fixtures built from
   the documented payloads. Field names the docs leave ambiguous (AbacatePay
   `frequency` values, Asaas `refunds[]` cumulative or not, MP subscription ↔
   payment linkage) are parsed leniently and noted in the matrix.
2. **Mercado Pago OAuth not built** (needs a platform MP application). Manual
   token + panel step instead; labelled honestly.
3. **Stripe per-mode evidence** on a Stripe connection's page now comes from
   that connection's recent events; the workspace-level `getIntegrationHealth`
   Stripe fields remain workspace-wide (unchanged API).
4. **Per-connection payment counts** attribute pre-0018 transactions (NULL
   `integration_id`) to the oldest connection of their provider.
5. `transactions` uniqueness is still `(workspace, provider, provider id)`: two
   accounts of the same provider are assumed not to mint the same payment id
   (true for all four providers' global ids; documented).
6. **"Expected attributed payment without commission"** also counts payments
   past a program's recurrence window (a legitimate skip) — a warning, not an
   error, with the reason visible per event.
7. Public docs and SEO pages still name Stripe only, **on purpose** (brief §71);
   beta providers are documented inside the product.
8. **Visual verification of the new screens**: see the session notes — the
   dashboard requires a signed-in user.
9. Setup-time targets (5–10 / 10–15 min) are not measured; the timestamps above
   make it measurable.

## BACKWARD_COMPATIBILITY

- `ifx_`, `indicafluxo_ref`, `_referral_ref`, `_referral_id`, `/t.js`,
  `/api/track`, `/api/identify` (request, response, errors): unchanged. Identify
  only widens its `provider` enum.
- Stripe per-workspace endpoint + `whsec_` and the legacy platform endpoint:
  unchanged contracts; Stripe event ids still claimed as-is.
- Existing Stripe rows keep bare customer ids everywhere.
- Functions that addressed "the" Stripe integration keep that meaning without an
  id (first connection).
- All 621 pre-existing tests pass unchanged.

---

```
UNIVERSAL_ATTRIBUTION_READY=YES
MULTI_PROVIDER_ARCHITECTURE_READY=YES
STRIPE_READY=YES
MERCADO_PAGO_READY=PARTIAL      (beta; manual webhook; no OAuth; not round-tripped)
ABACATEPAY_READY=PARTIAL        (beta; not round-tripped against a real account)
ASAAS_READY=PARTIAL             (beta; not round-tripped against a real account)
MULTI_ACCOUNT_READY=YES
CUSTOMER_IDENTITY_READY=YES
GUEST_CHECKOUT_READY=YES
DIAGNOSTICS_READY=YES
WIZARD_READY=YES
BACKWARD_COMPATIBILITY=PASS
RLS=PASS
TESTS=PASS
BUILD=PASS
```
