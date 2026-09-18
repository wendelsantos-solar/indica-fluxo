# MULTI_PROVIDER_INTEGRATION_AUDIT.md

Phase 0 of "Universal attribution + N billing connectors". What the code does
**today** (2026-09-18, working tree on `main` with the uncommitted integration
rework of `INTEGRATION_REWORK_REPORT.md`), what survives, and what has to move
before a second billing provider can exist without the founder integrating the
product twice.

Read with: `INTEGRATION_ARCHITECTURE_AUDIT.md` (Stripe evidence),
`INTEGRATION_ARCHITECTURE_V2.md` (token + bridge design),
`INTEGRATION_REWORK_REPORT.md` (what shipped), `BILLING_PROVIDER_MATRIX.md`
(provider research, same date).

Baseline verified before any change: `RUN_DB_TESTS=1 pnpm exec vitest run` —
**621 passed, 3 skipped, 61 files** (after applying the pending, additive
migration 0017 to the development database).

---

## CURRENT

```
/t.js ──► POST /api/track ──► recordClick ──► attributions (program, visitor)
                                   └──────► attribution_tokens (ifx_…, hashed)
POST /api/identify (secret key) ──► customers(external_id, provider, provider_customer_id)
                                    attributions.customer_external_id / provider_customer_id
Stripe ──► /api/webhooks/stripe/<integrationId>  (per-workspace whsec_)
       └─► /api/webhooks/stripe                  (platform secret, Connect: event.account)
             verify ─► claim webhook_events ─► StripeAdapter.normalizeEvent ─► ONE NormalizedBillingEvent
             ─► billing-events.handleBillingEvent ─► resolveCustomer ─► transactions
             ─► commission-writer.commissionForTransaction ─► calculateCommission ─► commissions
```

| Area | File(s) | State |
| --- | --- | --- |
| Normalized contract | `src/lib/billing/types.ts` | Closed union, primitives only, `provider` + `environment` + `providerAccountId` on every event. Already provider-free. |
| Provider port | `BillingProvider` in `types.ts`, registry `src/lib/billing/provider.ts` | One implementation (`StripeAdapter`). `verifyWebhook(raw, signature)` assumes one header + one platform secret; `buildConnectUrl`/`exchangeConnectCode` assume OAuth. |
| Stripe adapter | `src/lib/billing/stripe/*` | 11 handled events, token read from `client_reference_id` / `metadata[indicafluxo_ref]`, livemode per secret. Solid. |
| Ingest | `src/server/services/billing-events.ts` (1 367 lines) | Provider id is a parameter everywhere; one event per delivery; reasons are free text in `webhook_events.error_message`. |
| Commission engine | `src/server/domain/commission.ts` | Pure. Knows nothing of providers. **Unchanged by this phase.** |
| Commission writer | `src/server/services/commission-writer.ts` | Finds attribution by `provider_customer_id` OR `customer_external_id`. Provider-agnostic already. |
| Attribution token | `attribution_tokens` + `attribution-bridge.ts` | Workspace + environment scoped, not keyed by integration — explicitly designed for a second provider. |
| Customer | `customers` (one row per `(workspace, env, provider, provider_customer_id)` and per `(workspace, env, external_id)`) | **One provider identity per customer row.** |
| Connection | `integrations` | `UNIQUE (workspace_id, provider)` — **one connection per provider per workspace**. Status `connected / disconnected / error`. `encrypted_credentials` AES-256-GCM. |
| Idempotency | `webhook_events UNIQUE (scope, provider, provider_event_id)`; `transactions UNIQUE (workspace, provider, provider_transaction_id)`; `transaction_references`; advisory locks | Correct for Stripe (event ids are globally unique). |
| Health | `integration-health.ts`, `stripe-status.ts` | Stripe-only: `health.stripe.*`. Evidence-based states, attribution signal per mode. |
| UI | `integrations/page.tsx`, `stripe-panel.tsx` (847 lines), `identify-section.tsx`, `api-keys-panel.tsx`, `integrations-aside.tsx` | One long page: Stripe → keys/tracker → identify → aside. |
| Onboarding | `features/onboarding/activation.ts` | Steps `workspace, program, affiliate, testConversion, tracking, stripe, liveMode`. |
| Audit | `recordAudit` → `audit_logs` | `integration.connected` / `integration.disconnected` only. |
| Docs | `(docs)/docs/page.tsx`, `features/docs/*` | Stripe-first guide: "Choose how you charge" lists four Stripe strategies. |

## WHAT_CAN_BE_REUSED

1. **`NormalizedBillingEvent` and everything below it** — `handleBillingEvent`,
   `recordPayment`, `recordRefund`, reversal planning, `commission-writer`,
   `calculateCommission`. They already take `provider` as data. A second
   provider is a second *producer* of this union, not a change to its consumers.
2. **Attribution token + bridge.** `ifx_` + 43 base64url chars fits every
   researched provider's reference field (Mercado Pago `external_reference`
   ≤ 64 chars `[A-Za-z0-9_-]`; Asaas `externalReference`; AbacatePay
   `externalId`). Hashed, workspace + environment scoped, first bind wins.
   **Kept as the one universal checkout reference.**
3. **`/api/identify`** — already provider-parameterised (`provider`,
   `providerCustomerId`). It is the Customer-first entry point the brief asks
   for. Contract kept; only the enum widens.
4. **`transaction_references` + advisory locks** — a generic "many ids, one
   payment" map. Not Stripe-specific.
5. **`webhook_events` claim/mark** — generic; needs a connection column and a
   reason code, not a redesign.
6. **`integrations` table** — already has `provider`, `provider_account_id`,
   `status`, `encrypted_credentials`, `metadata`, `connected_at`,
   `disconnected_at`. It *is* `billing_connections`; a second table would
   duplicate it (CLAUDE.md rule 10). Evolve it.
7. **Sandbox simulation** (`services/sandbox.ts`) — runs through the real
   services with provider `manual`. It is the "Simular fluxo" the brief wants.
8. **Crypto** (`lib/crypto/secrets.ts` AES-256-GCM, `lib/crypto/hash.ts`
   peppered hashes) and **audit** (`recordAudit`).

## WHAT_IS_COUPLED_TO_STRIPE

| Coupling | Where | Why it matters |
| --- | --- | --- |
| `UNIQUE (workspace_id, provider)` on `integrations` | migration 0000 | Blocks "Stripe Brasil + Stripe EUA". |
| `onConflictDoUpdate({ target: [workspaceId, provider] })` | `startStripeIntegration`, `completeStripeConnect` | Same. |
| `getStripeSetup`, `disconnectIntegration(workspace, provider)`, `integrationAccountId` pick "the" Stripe row | `services/integrations.ts`, `stripe-connect.ts` | Must address a connection by id. |
| `health.stripe` shape | `integration-health.ts`, `activation.ts`, overview, integrations page | Health is per provider name, not per connection. |
| `billing_provider` enum = `stripe, paddle, manual` | `enums.ts`, `identify` contract, `webhook-events.ts` input type | New providers must be enum values. |
| `BillingProvider.verifyWebhook(raw, signature)` | `types.ts` | Mercado Pago signs `id + request-id + ts`; Asaas sends a shared token header; AbacatePay a query secret **and** an HMAC with a global key. One `signature` string cannot express these. |
| `normalizeEvent` is synchronous and returns one event | `types.ts`, `ingestVerifiedWebhook` | Mercado Pago notifications are **thin** (`data.id` only): the adapter must fetch the payment. One Asaas/MP payment state can mean payment + refund at once. |
| `PaymentRefundedEvent.amountMinor` is the refund's own amount | `types.ts`, `recordRefund` | Mercado Pago (`transaction_amount_refunded`) and Asaas (`refunds[]`) report **cumulative** refunded amounts. |
| Ignore reasons are free text (`"payment has no customer"`) matched by SQL | `billing-events.ts`, migration 0015 | Diagnostics cannot group by cause across providers. |
| `webhook_events` has no connection id | schema | Cannot say *which* account is failing. |
| Ingest route per provider only for Stripe | `app/api/webhooks/stripe/*` | New providers need a route; must not copy three times. |
| UI | `stripe-panel.tsx`, `integrations-aside.tsx`, `activation.ts` step `stripe` | Product reads "Stripe integration", not "billing". |
| Docs | "Choose how you charge" = four Stripe strategies | Teaches Stripe fields, not the product's own API. |

## WHAT_MUST_CHANGE

1. **`integrations` becomes the billing-connection table** (no rename — the
   table name is not user-facing and a rename breaks every query):
   - replace `UNIQUE (workspace_id, provider)` by
     `UNIQUE (workspace_id, provider, provider_account_id) WHERE provider_account_id IS NOT NULL`;
   - add `display_name`, `environment` (nullable: a Stripe connection spans
     both modes through two endpoint secrets), `last_verified_at`,
     `status_reason`;
   - add `pending` to `integration_status` (connecting, before the provider
     confirmed anything).
2. **`billing_identities`** (new): `(customer_id, provider, provider_customer_id,
   integration_id)`. One customer, N provider identities. Backfilled 1:1 from
   `customers.provider_customer_id`. `customers.provider/provider_customer_id`
   stay and keep being written (dual write) — the columns are read by the
   sandbox, analytics and the legacy path.
   *This reverses the decision of `INTEGRATION_ARCHITECTURE_V2.md` §1, and the
   reason that decision gave is now gone: it deferred the table "until a second
   provider exists". This phase adds three.*
3. **`webhook_events`**: add `integration_id` (which connection) and
   `reason_code` (why ignored/failed, from a closed list). Idempotency for
   providers whose event ids are not documented as globally unique is scoped
   to the connection.
4. **Connector port**: `BillingConnector` = descriptor (capabilities, connection
   method, webhook mode) + `verify(delivery, secrets)` + async
   `normalize(verified, context) → NormalizedBillingEvent[]`. Stripe keeps its
   adapter and gets a descriptor.
5. **Normalized contract (additive)**: providers `mercado_pago`, `abacatepay`,
   `asaas`; `cumulativeRefundedMinor` on refunds; `externalCustomerId` on
   payment/subscription events (the SaaS's own id, when the checkout carried
   it); `payment.failed` (recorded for diagnostics, never money).
6. **Ingest**: one generic route `POST /api/webhooks/billing/[provider]/[integrationId]`
   for every non-Stripe connector; Stripe routes stay byte-compatible.
7. **Health per connection** + a derived overall state; diagnostics pipeline and
   "expected attributed payment without commission".
8. **UI**: Integrations gets tabs (Overview · Payments · Tracking · API),
   connection cards, add-provider dialog, per-connection detail. Onboarding step
   `stripe` becomes `billing` (≥ 1 working connection).
9. **Docs**: the guide says "integrate once, connect providers"; the checkout
   bridge is taught as the product's own fields, with Stripe as the documented
   provider. Beta providers are **not** documented publicly (SEO rule, brief §71).

## MIGRATION_RISK

| Change | Risk | Mitigation |
| --- | --- | --- |
| New enum values on `billing_provider`, `integration_status` | `ALTER TYPE … ADD VALUE` cannot be *used* in the transaction that adds it; the Drizzle migrator runs pending files in one transaction | The migration adds values and uses none of them in SQL. |
| Drop `integrations_workspace_provider_key` | Code relying on the conflict target breaks | Every `onConflict` on it is rewritten in the same change; new partial unique on account keeps "one row per account". Existing rows all have ≤ 1 Stripe row per workspace, so the new index builds. |
| `billing_identities` backfill | Duplicate `(workspace, env, provider, provider_customer_id)` would fail the unique index | Source is `customers`, which already has that exact unique index — backfill cannot conflict. `ON CONFLICT DO NOTHING` anyway. |
| Dual write customers ↔ billing_identities | Drift | One helper (`linkBillingIdentity`) is the only writer; reads go identities-first, customers-second. |
| `webhook_events` new nullable columns | None (no rewrite) | — |
| Rollback | — | Every step is additive except the index swap; rollback = recreate `UNIQUE (workspace_id, provider)` (valid while each workspace keeps one row per provider) and drop the new objects. Documented in the migration. |

No row is rewritten, no column dropped, no ledger table touched.

## SECURITY_RISK

| Risk | Assessment | Decision |
| --- | --- | --- |
| **API keys at rest** (Asaas, AbacatePay, Mercado Pago access token) | These are *full-access* secrets (Asaas has no read-only scope; AbacatePay scopes exist but webhook permission is outside the documented table). Worse than a `whsec_`. | AES-256-GCM in `encrypted_credentials` (existing mechanism), never returned, never logged, dropped on disconnect. UI says so, and it is true. |
| Weak delivery authentication | Asaas: shared `asaas-access-token` header, no HMAC. AbacatePay: HMAC key is a **global public constant** — it proves "from AbacatePay", not "for this merchant"; the per-webhook secret travels in the **query string**. | Per-connection random secret (Asaas `authToken`, AbacatePay `webhookSecret`) generated by us, compared in constant time; for AbacatePay both checks are required. Query strings are never logged (`logger` receives no URL). |
| Thin payloads (Mercado Pago) | A verified notification says "payment X changed"; the truth is fetched from MP with the merchant's token | Fetch only by the notified id, only with the connection's own token, only from the fixed API host. Never follow URLs from the payload. |
| Event-id collisions across merchants | Only Stripe documents globally unique event ids | Non-Stripe event ids are claimed as `<integration_id>:<provider event id>`. |
| Customer-id collisions across providers | `"123"` at Stripe and `"123"` at MP | Provider is part of every identity key (`billing_identities`, `customers`, `transactions`). Tested. |
| `externalCustomerId` from a checkout | Could be forged if it came from a browser-settable field | Read **only** from server-set metadata (Stripe `metadata`, MP `metadata`), never from `client_reference_id`, `external_reference` or a URL. Worst case of a forged value is crediting an affiliate the customer already had — same bound as the token. |
| Members reading `integrations.encrypted_credentials` | RLS lets members `SELECT` the table; the column holds ciphertext | Unchanged exposure (ciphertext only, key server-side). Services never select it for UI reads. Noted, not widened. |
| Affiliate portal | Affiliates are not workspace members | New tables use `member_workspace_ids()` — affiliates get nothing. Tested. |

## UX_GAPS

1. The product talks "Stripe", not "payments": page title, panel, checklist step,
   aside, docs.
2. No way to connect a second account or a second provider.
3. No provider selection; no "add later"; no honest per-provider effort label.
4. Health is one badge for "Stripe"; no per-account "connected but webhook
   failing"; errors mix provider jargon (`whsec_`, 401).
5. Diagnostics stop at "events arrive but earn nothing" per mode; no pipeline,
   no named reason per payment, organic vs broken not separated.
6. Tracker and identify are two separate sections with no live detection of the
   identify step.
7. No "test the whole thing" affordance beyond the sandbox simulation.
8. Technical detail (webhook URL, account id, secrets) is always on screen.

## RECOMMENDED_PLAN

| # | Step | Ships |
| --- | --- | --- |
| P0.1 | Migration 0018: enum values, `integrations` evolution, `billing_identities` + backfill + RLS, `webhook_events.integration_id/reason_code`, `workspaces.integration_plan`, SECURITY DEFINER read functions | schema |
| P0.2 | Contract: provider ids, catalog + capabilities + availability flags, `BillingConnector`, additive event fields, decimal→minor | `lib/billing` |
| P0.3 | Identity: `linkBillingIdentity`, identities-first `resolveCustomer`, token→customer and `externalCustomerId` linking (provider switch), identify writes identities | services |
| P0.4 | Ingest: generic route, multi-event normalize, connection-scoped idempotency, reason codes, env mismatch refusal | services + route |
| P1 | Stripe unchanged in behaviour; addressed by connection id; multi-account; descriptor | Stripe |
| P2–P4 | Mercado Pago, AbacatePay, Asaas connectors (beta, flag-gated), shared contract-test suite, sanitized fixtures | connectors |
| P5 | Health model, diagnostics pipeline, payment-without-commission, funnel timestamps | health |
| P6 | UI: tabs, cards, add/connect dialogs, detail, wizard progress, test pipeline | UI |
| P7 | Docs + reports | docs |

Order deviation from the brief, justified in `BILLING_PROVIDER_MATRIX.md`:
**Asaas and AbacatePay allow automatic webhook registration by API; Mercado
Pago does not** (panel only, per current docs) and additionally needs a fetch per
notification. MP stays P2 by business priority, but it is the connector with the
most manual steps, and the UI says so.
