# MULTI_PROVIDER_DOCS_AUDIT.md

Every claim the multi-provider phase added or changed in user-facing text —
public guide (`/docs`), beta guide (`/docs/beta`, noindex), landing FAQ and the
in-product copy — with the code that makes it true, the maturity of the
provider it concerns, and whether it is safe to publish. Date: 2026-09-18.

`SAFE_TO_PUBLISH`: **YES** = true in code, fine on an indexable page ·
**BETA-ONLY** = true in code, but only on `/docs/beta` or inside the product ·
**NO** = not published.

## Public guide (`/docs`, indexable)

| CLAIM | CODE EVIDENCE | PROVIDER STATUS | SAFE_TO_PUBLISH |
| --- | --- | --- | --- |
| Tracker and customer identity do not depend on the payment method | `/t.js`, `POST /api/track`, `POST /api/identify` have no provider branch; `identify.ts` takes `provider` as data | all | YES |
| "Stripe is the stable method today" | `CONNECTORS.stripe.defaultAvailability = "public"` (`lib/billing/catalog.ts`); the other three are `"beta"` | Stripe stable | YES |
| Identify links the referral to the customer at signup (customer-first) | `identify.ts` writes `attributions.customer_external_id`; `commission-writer.ts` `findAttribution` matches by `customer_external_id` | all | YES |
| A payment finds the customer by (1) provider identity, (2) your user id in metadata, (3) the reference, (4) e-mail with exactly one match of the same method | `billing-events.ts` `resolveCustomer` (identity → legacy column → `externalCustomerId` → e-mail hash `identifiedCustomerByEmail`, `rows.length !== 1`); token → identified visitor in `attribution-bridge.ts` | all | YES |
| Customers are never merged by e-mail | `identifiedCustomerByEmail` only links when exactly one identified customer matches; no merge path exists | all | YES |
| Your user id travels in metadata only on Stripe and Mercado Pago | `checkout-bridge.ts`: `abacatepay`/`asaas` return `customer: "identify"`; pinned by `features/docs/__tests__/universal-docs.test.ts` | Stripe stable, MP beta | YES (MP labelled Beta in the table) |
| Switching method keeps the same customer and attribution | `multi-provider.db.test.ts` "provider switch: Stripe first, Mercado Pago later, same attribution" | Stripe stable, others beta | YES (worded as "another connected method", no beta name) |
| …but the window, duration, approval, currency and environment still apply | `domain/commission.ts` (`isConversion` gates the window; `isWithinRecurrenceWindow` anchored on `firstCommissionedAt`; `participation.status !== "approved"`; `currency_mismatch`); `findAttribution` filters `programs.environment` | all | YES |
| Duration counts from the first commissioned payment on any method | `commission-writer.ts` first commission query is by participation + customer, not provider | all | YES |
| Pausing/archiving a program stops new attributions from clicks; already-attributed customers keep earning within the rules | `tracking.ts` `trackable = programStatus === "active" && …`; commission engine has no program-status gate (reported in `MULTI_PROVIDER_IMPLEMENTATION_REPORT.md`, `PROGRAM_INACTIVE` not emitted) | all | YES |
| Guest checkout: the reference travels to the checkout and back in the webhook; a reference counts once; expires with the window; nothing is recorded without customer and reference | `attribution-bridge.ts` first-bind-wins; `attribution_tokens.expires_at`; `billing-events.ts` drops payments with neither (tested "a payment with neither customer nor reference stays out of the ledger") | all | YES |
| Checkout Bridge: the product picks the provider field; **no SDK to install** | `checkoutFields` is internal (`lib/billing/checkout-bridge.ts`); the product shows generated snippets (`bridge-snippets.ts`) in Integrations → API. The guide says "no SDK" on purpose — there is no published package | all | YES |
| Field table (Stripe `client_reference_id` · `metadata.indicafluxo_ref`, …) | derived at render time from `checkoutFields` via `bridgeFieldNames` (`features/docs/universal.ts`), test-pinned | Stripe stable, others Beta-labelled | YES |
| Stripe: "Authorize on Stripe" when the button is shown, otherwise the manual endpoint | `stripeConnectAvailable()` gates the OAuth button (`stripe-connect.ts`); manual path unchanged | Stripe | YES |
| Multiple payment methods: install once, connect each account; optional ones block nothing | `features/integrations/setup.ts` (`ready` needs one working connection; others `optional`), tested | all | YES |
| Multiple accounts: each with its own name, health and events; rename later | `integrations.display_name`; `renameConnectionAction`; per-connection health in `connection-health.ts` | Stripe (multi-account tested), beta ones tested with fixtures | YES |
| One account may hold a test and a live connection; events never mix | migration 0019 + `multi-provider.db.test.ts` "one provider account holds a test and a live connection"; `TEST_LIVE_MISMATCH` in `ingestVerifiedWebhook` | MP beta, Stripe spans both on one row | YES |
| Customer identity vs billing identity; provider is part of the key | `billing_identities` unique `(workspace, environment, provider, provider_customer_id)`; test "Stripe customer '123' and Mercado Pago customer '123' never collide" | all | YES |
| Diagnostics pipeline (Referral → Customer identified → Payment received → Customer recognised → Eligible attribution → Commission created) | `diagnoseRecentPayments` (`connection-health.ts`) steps; rendered on the connection page | all | YES |
| A payment with no referral is normal and never alerts | `deriveConnectionHealth`: only `expectedWithoutCommission` raises a warning; organic steps render neutral | all | YES |
| Reason sentences (NO_ATTRIBUTION, ATTRIBUTION_EXPIRED, …) | `lib/billing/reasons.ts` closed list; sentences in `dashboard.integrations.reasons` (both catalogues) | all | YES |
| API keys/tokens of beta methods: AES-256-GCM, never shown again, never logged, deleted on disconnect | `encryptSecret` in `connectApiProvider`; `disconnectBillingConnection` sets `encrypted_credentials = null` (test "disconnecting stops new events and keeps the ledger"); logger redaction | beta methods | YES (no provider named) |
| Stripe: no Stripe key held | Stripe connection stores only `whsec_` secrets or an OAuth `acct_` (`integrations.ts`, `stripe-connect.ts`) | Stripe | YES |
| Per-connection notification secrets generated by the product, compared in constant time | `randomBytes(32)` in `connectApiProvider`; `safeEqual` in the Asaas and Mercado Pago connectors; AbacatePay checks query secret + HMAC | beta | YES |
| Disconnect keeps transactions and commissions | test "disconnecting stops new events and keeps the ledger" | all | YES |

## Beta guide (`/docs/beta`, noindex)

| CLAIM | CODE EVIDENCE | PROVIDER STATUS | SAFE_TO_PUBLISH |
| --- | --- | --- | --- |
| Beta = built + contract-tested with official-doc payloads + no real-account round trip | `connector-contract.test.ts`, `__fixtures__/providers.ts`; `PROVIDER_PRODUCTION_VALIDATION.md` all boxes open | beta | BETA-ONLY |
| Mercado Pago needs one manual panel step (URL + topics + secret); healthy only after the first verified notification | `connectApiProvider` leaves MP `pending` without secret; health `connecting` until an event; `MERCADO_PAGO_TOPICS` rendered from the connector | MP beta | BETA-ONLY |
| MP test-credential payments send no notifications | `BILLING_PROVIDER_MATRIX.md` (official docs); `catalog.ts` `testMode: false` | MP beta | BETA-ONLY |
| MP refunds full + partial (cumulative), `charged_back` reverses | `mercado-pago/connector.ts` (`cumulativeRefundedMinor`, `isChargeback: true` on `charged_back`) | MP beta | BETA-ONLY |
| AbacatePay/Asaas: "{brand} configures the webhook automatically after validating your key" | `abacatepay/connector.ts` `POST /v2/webhooks/create`; `asaas/connector.ts` `POST /v3/webhooks`; Asaas webhook removed on disconnect | beta | BETA-ONLY |
| AbacatePay: full refunds only; an opened dispute reverses; no dispute-won | `*.disputed` → `isChargeback: true`; `*.lost` keeps it; catalog `partialRefunds: false`, `disputeWon: false` | AbacatePay beta | BETA-ONLY |
| Asaas: no HMAC (connection token), no read-only key, keys disabled after 3 months | `asaas/connector.ts` header token; matrix (official docs) | Asaas beta | BETA-ONLY |
| Events lists | rendered from `ABACATEPAY_EVENTS`, `ASAAS_EVENTS`, `MERCADO_PAGO_TOPICS` | beta | BETA-ONLY |

## Landing (indexable)

| CLAIM | CODE EVIDENCE | PROVIDER STATUS | SAFE_TO_PUBLISH |
| --- | --- | --- | --- |
| FAQ "Funciona com Stripe?" → "Stripe is the stable method today… Other methods are still being validated." (was "hoje só com Stripe", no longer exact) | catalog availability | Stripe stable | YES (no beta name) |
| FAQ "Uses more than one payment method?" → tracking + identity once; each method is a connected account; guest checkout needs the reference | `setup.ts`, `checkout-bridge.ts`, `resolveCustomer` | all | YES (no beta name, no "supports X") |
| Meta titles/descriptions still name Stripe only | `docs.metaTitle`, `docs.metaDescription`, marketing meta unchanged | Stripe | YES |

## Not published (on purpose)

| CLAIM | WHY NOT |
| --- | --- |
| "Stripe, Mercado Pago, Asaas e AbacatePay" as equivalent features | three are Beta (brief §3) |
| SEO pages `/afiliados-mercado-pago`, `/afiliados-asaas`, `/afiliados-abacatepay` | backlog, blocked: `requires PRODUCTION_READY connector` (`SEO_CONTENT_MAP.md`) |
| An installable `checkoutFields` SDK | does not exist; the guide shows fields and generated snippets only |
| Setup-time claims ("5 minutes") | not measured (`MULTI_PROVIDER_IMPLEMENTATION_REPORT.md` §9) |
| "Affiliate keeps credit forever after a provider switch" | false as stated; the engine's rules still apply (see `UNIVERSAL_ATTRIBUTION_ARCHITECTURE.md` §3) |

---

## Final polish pass (2026-09-18)

### Information architecture

Sidebar = the integration order: **Começando** (Introdução · Guia rápido ·
Como funciona) → **Integração** (Rastreamento · Identificação do cliente ·
Customer-first · Checkout sem cadastro) → **Meios de pagamento** (Stripe ·
Referência no checkout do Stripe · Mercado Pago β · AbacatePay β · Asaas β ·
Vários meios · Várias contas · O que é Beta) → **Conceitos** (Atribuição [+
Programa pausado] · Cliente · Comissão · Reembolsos · Retenção) → **API**
(Identify · Referência no checkout · Webhooks do Stripe · Erros) →
**Diagnóstico** (Testar · Saúde da integração [+ Diagnóstico avançado] ·
Pagamento sem comissão) → **Segurança** (Credenciais · Chaves de API ·
Webhooks · Teste e produção). No empty page was created. Every existing anchor
kept (`antes-de-comecar` now sits inside the quickstart). Step numbers left
the sidebar: only the quickstart is numbered.

"On this page" shows the sections of the group being read and the sub-parts
of the active section only (≤ 7 lines instead of ~40).

### New or changed claims

| CLAIM | CODE EVIDENCE | SAFE_TO_PUBLISH |
| --- | --- | --- |
| Quickstart: install → identify (real `fetch` to `/api/identify`, no SDK) → connect → test → commission | `customerFirstSnippet` in `features/docs/snippets.ts`, test "customer-first sample" parses the body against `identifyBodySchema` and the cookie regex | YES |
| Chips: Stripe *Estável*, Mercado Pago / AbacatePay / Asaas *Beta* (linking to the noindex beta page) | `CONNECTORS[*].defaultAvailability` | YES (labelled) |
| "Uma integração, vários meios de pagamento" | `/t.js`, `/api/track`, `/api/identify` have no provider branch | YES |
| Main diagram Indicação → Rastreador → Cliente → {any method} → Transação → Comissão (HTML/CSS, `FanDiagram`) | as above | YES |
| **Program pause** is an official rule | `tracking.ts` gate; engine without status gate; DB test "a paused program keeps paying…"; `PROGRAM_PAUSE_SEMANTICS.md` | YES |
| Refunds: full reverses (original → Revertida if unpaid), partial proportional and cumulative, dispute reverses, dispute won restores on Stripe only, **paid commission is not clawed back** | `calculateReversal`, `planReversal` (`paid` → reversal row `reversed`, not netted), `shouldRestoreChargeback`; catalog `disputeWon` true for Stripe only | YES |
| Status vocabulary and "a state is not a problem" | `deriveConnectionHealth`, `connectionDisplayState` | YES |
| Advanced diagnostics objects (Attribution · Customer · Billing Identity · Billing Event · Transaction · Commission) | schema tables `attributions`, `customers`, `billing_identities`, `webhook_events`, `transactions`, `commissions` | YES |
| Referred payment without commission — reasons, "not exhaustive" | `REASON_CODES` (19 codes; the guide lists the common ones and says so) | YES |
| Webhook security: verified before read, refused with no effect, once, test/live isolated, opaque random `ifx_`, user id only from the server | connectors' verification + `safeEqual`; `webhook_events` claim; `TEST_LIVE_MISMATCH`; `ATTRIBUTION_TOKEN_PATTERN` 32 random bytes; `readExternalCustomerIdFromMetadata` | YES (no thresholds or internals published) |
| Multiple accounts: same workspace, own name/status, isolated events, one customer id with per-method ids | `integrations.display_name`; per-connection claim `<connection>:<id>`; `billing_identities` keyed by provider + environment | YES (does **not** claim identities per account — they are per method) |
| `/docs/beta`: status row, "Beta ≠ Em breve", how to report a problem (connection id, last event, last reason; never credentials) | beta page | BETA-ONLY |

### Fixed on the way

- **`/docs/beta` sent signed-out readers to the login page.** It was absent
  from `PUBLIC_PATHS` (`src/proxy.ts` makes only indexable pages public), while
  the public guide links to it from every beta method. Now public, still
  `noindex, nofollow`, still out of the sitemap; test "keeps the beta guide
  reachable signed out".

### Search claims re-checked

Home hero/eyebrow, pricing, marketing FAQ, docs `metaTitle`/`metaDescription`,
OG images and JSON-LD name Stripe only (or no provider). The FAQ answer now
reads: "O rastreamento e a identificação do cliente são feitos uma vez. Depois
você conecta as contas de cobrança que utiliza. Em checkouts sem cadastro, pode
ser necessário levar a referência de atribuição até o pagamento." No beta name
on an indexable marketing page; the guide names them only with a *Beta* label.
