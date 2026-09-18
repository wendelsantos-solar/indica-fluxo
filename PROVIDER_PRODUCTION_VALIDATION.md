# PROVIDER_PRODUCTION_VALIDATION.md

What each **Beta** payment method must prove against a real account (or the
provider's official sandbox) before it may become **Stable**. Updated
2026-09-18 (stabilization round).

**Source of truth:** `src/lib/billing/validation.ts` (typed ledger). This file
is its readable mirror; `src/lib/billing/__tests__/validation.test.ts` fails
if they drift or if a connector is marked `stable`/`public` without a complete
ledger.

---

## 1. Maturity model

| Internal maturity | Meaning | UI label |
| --- | --- | --- |
| `coming_soon` | Not connectable | Em breve |
| `beta_implemented` | Built; contract, fixture and DB tests pass; **no real round trip** | Beta |
| `beta_real_tested` | Some real round trips PASS; ledger incomplete | Beta |
| `stable` | Every applicable item PASS, or N/A with a justification | Estável |

Current state (`CONNECTORS[*].maturity`, `src/lib/billing/catalog.ts`):

| Provider | Availability (UI) | Maturity | Real validation |
| --- | --- | --- | --- |
| Stripe | public — Estável | `stable` (predates the ledger; see §6) | OAuth round trip: **NOT_STARTED** |
| Mercado Pago | beta | `beta_implemented` | **NOT_STARTED** |
| AbacatePay | beta | `beta_implemented` | **NOT_STARTED** |
| Asaas | beta | `beta_implemented` | **NOT_STARTED** |

## 2. Rules

1. **Unit, contract, fixture and DB tests are required and never sufficient.**
   Stable needs a round trip against a real account or the official sandbox.
2. **Stable = every item PASS or N/A.** N/A only when the provider does not
   offer the capability, with the source. Never PASS by analogy.
3. A FAIL blocks Stable until fixed and re-run from that item.
4. The gate is enforced in code: `maturityGate(id)`; `public` availability
   requires `stable`, and `stable` requires `maturityGate(id).canBeStable`.
5. After Stable: flip `maturity` + `defaultAvailability`, move the method from
   `/docs/beta` into the guide, update `BILLING_PROVIDER_MATRIX.md`, and only
   then consider the SEO backlog (`SEO_CONTENT_MAP.md`, "requires
   PRODUCTION_READY connector").

## 3. Evidence format

Each validated row records **provider · capability · date · environment ·
result · evidence · notes**. Evidence is an opaque reference only — a provider
event id (`evt_…`, `log_…`, a Mercado Pago notification id), the connection id,
a screenshot file name.

**Never recorded:** access tokens, API keys, webhook secrets, signing secrets,
customer names, e-mails, documents (CPF/CNPJ) or raw payloads. The test suite
rejects secret-shaped values in the ledger.

How to run a check: dedicated workspace, one connection per run, keep the
connection page open (Status · Diagnóstico · Atividade · Configurações
avançadas for ids), compare with the provider's panel, then grep the server
logs of the run for the key/token prefix (must find nothing).

## 4. Test method per provider

| Provider | Official method | Notes |
| --- | --- | --- |
| Mercado Pago | Test credentials (`TEST-…`) + **panel webhook simulator** for signatures; **small real payment** for the money path | Payments made with test credentials send **no** notifications (official docs) — the simulator does not prove the money path |
| AbacatePay | **Dev mode** key (`abc_dev_…`), purchases in dev mode | Dev-mode events carry `devMode` |
| Asaas | **Sandbox** (`api-sandbox.asaas.com`, `$aact_hmlg_…`) — a separate account | Sandbox and production are different accounts: each is its own connection |
| Stripe | Test mode, `4242 4242 4242 4242`, `stripe trigger`; OAuth needs the platform Connect client | See §6 |

---

## 5. Ledgers

### Mercado Pago — `beta_implemented`

Manual step to validate explicitly (brief §18):

```
Conta conectada → notificações configuradas no painel → assinatura secreta
→ primeira notificação verificada → Saudável
```

**"Já configurei — verificar" must not be a false positive.** In code it stores
the secret; the connection shows *Aguardando eventos* until a verified
notification arrives — never *Saudável* (DB test "Mercado Pago: saving the
panel secret is not a false positive"). The real run must confirm: wrong
secret → deliveries refused and the rejection visible; right secret → first
simulator notification turns it *Saudável*.

| Item | Check | Result | Date | Env | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `realConnection` | Connect a real account or the official sandbox | PENDING | — | — | — |  |
| `authentication` | Credential accepted; a revoked one turns the connection *Ação necessária* | PENDING | — | — | — |  |
| `webhookSetup` | Webhook registered (automatic) or configured (panel) | PENDING | — | — | — |  |
| `webhookVerification` | A real delivery verifies (signature / connection secret) | PENDING | — | — | — |  |
| `firstPayment` | First paid payment → one transaction | PENDING | — | — | — |  |
| `customerIdentity` | `POST /api/identify` for the payer's account | PENDING | — | — | — |  |
| `billingIdentity` | The provider's customer id lands in `billing_identities` | PENDING | — | — | — |  |
| `attribution` | The referral's affiliate is the one credited | PENDING | — | — | — |  |
| `commission` | Amount, currency, hold and rule text correct | PENDING | — | — | — |  |
| `renewal` | Second cycle → same customer, same attribution, no reference | PENDING | — | — | — |  |
| `fullRefund` | Full refund → reversal, original *Revertida* if unpaid | PENDING | — | — | — |  |
| `partialRefund` | Partial refund(s) → proportional, cumulative reversal | PENDING | — | — | — |  |
| `dispute` | Chargeback/dispute → reversal | PENDING | — | — | — |  |
| `duplicateWebhook` | Redelivery → `duplicate`, nothing doubled | PENDING | — | — | — |  |
| `invalidSignature` | Tampered/unsigned delivery → refused, nothing recorded, rejection visible | PENDING | — | — | — |  |
| `testLiveIsolation` | Test event on a live connection (or reverse) → `TEST_LIVE_MISMATCH` | PENDING | — | — | — |  |
| `disconnect` | Disconnect → new events refused, ledger kept, provider webhook removed when supported | PENDING | — | — | — |  |
| `reconnect` | Reconnect → events flow again, no duplicate connection | PENDING | — | — | — |  |
| `multiAccount` | Two accounts in one workspace, events never cross | PENDING | — | — | — |  |
| `diagnostics` | Pipeline + reason correct for an organic and an attributed-without-commission payment | PENDING | — | — | — |  |
| `noSecretInLogs` | Server logs of the whole run contain no key, token, secret, payload or e-mail | PENDING | — | — | — |  |

Open questions: subscription ↔ payment linkage fields; notification-id
uniqueness across sellers (scoped to the connection anyway).

### AbacatePay — `beta_implemented`

Validate: API key → automatic webhook (`POST /v2/webhooks/create`, visible in
the AbacatePay panel) → payment → refund → dispute (opened reverses; there is
no "won" event) → disconnect/reconnect. Both checks on each delivery: our
query secret **and** the published HMAC.

| Item | Check | Result | Date | Env | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `realConnection` | Connect a real account or the official sandbox | PENDING | — | — | — |  |
| `authentication` | Credential accepted; a revoked one turns the connection *Ação necessária* | PENDING | — | — | — |  |
| `webhookSetup` | Webhook registered (automatic) or configured (panel) | PENDING | — | — | — |  |
| `webhookVerification` | A real delivery verifies (signature / connection secret) | PENDING | — | — | — |  |
| `firstPayment` | First paid payment → one transaction | PENDING | — | — | — |  |
| `customerIdentity` | `POST /api/identify` for the payer's account | PENDING | — | — | — |  |
| `billingIdentity` | The provider's customer id lands in `billing_identities` | PENDING | — | — | — |  |
| `attribution` | The referral's affiliate is the one credited | PENDING | — | — | — |  |
| `commission` | Amount, currency, hold and rule text correct | PENDING | — | — | — |  |
| `renewal` | Second cycle → same customer, same attribution, no reference | PENDING | — | — | — |  |
| `fullRefund` | Full refund → reversal, original *Revertida* if unpaid | PENDING | — | — | — |  |
| `partialRefund` | Partial refund(s) → proportional, cumulative reversal | N/A | — | — | — | AbacatePay offers full refunds only (official docs). Run must confirm the product never shows a partial one. |
| `dispute` | Chargeback/dispute → reversal | PENDING | — | — | — | Opened dispute reverses; no dispute-won event exists — restoration is N/A by design. |
| `duplicateWebhook` | Redelivery → `duplicate`, nothing doubled | PENDING | — | — | — |  |
| `invalidSignature` | Tampered/unsigned delivery → refused, nothing recorded, rejection visible | PENDING | — | — | — |  |
| `testLiveIsolation` | Test event on a live connection (or reverse) → `TEST_LIVE_MISMATCH` | PENDING | — | — | — |  |
| `disconnect` | Disconnect → new events refused, ledger kept, provider webhook removed when supported | PENDING | — | — | — |  |
| `reconnect` | Reconnect → events flow again, no duplicate connection | PENDING | — | — | — |  |
| `multiAccount` | Two accounts in one workspace, events never cross | PENDING | — | — | — |  |
| `diagnostics` | Pipeline + reason correct for an organic and an attributed-without-commission payment | PENDING | — | — | — |  |
| `noSecretInLogs` | Server logs of the whole run contain no key, token, secret, payload or e-mail | PENDING | — | — | — |  |

Open questions: `frequency` values on subscriptions; whether
`subscription.payment_failed` can be subscribed.

### Asaas — `beta_implemented`

Validate: API key → automatic webhook (`POST /v3/webhooks`, removed on
disconnect) → payment (Pix `RECEIVED`; card `CONFIRMED`+`RECEIVED` = one
transaction) → subscription renewal → refund → webhook token
(`asaas-access-token`, constant time; wrong token refused) →
disconnect/reconnect.

| Item | Check | Result | Date | Env | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `realConnection` | Connect a real account or the official sandbox | PENDING | — | — | — |  |
| `authentication` | Credential accepted; a revoked one turns the connection *Ação necessária* | PENDING | — | — | — |  |
| `webhookSetup` | Webhook registered (automatic) or configured (panel) | PENDING | — | — | — |  |
| `webhookVerification` | A real delivery verifies (signature / connection secret) | PENDING | — | — | — |  |
| `firstPayment` | First paid payment → one transaction | PENDING | — | — | — |  |
| `customerIdentity` | `POST /api/identify` for the payer's account | PENDING | — | — | — |  |
| `billingIdentity` | The provider's customer id lands in `billing_identities` | PENDING | — | — | — |  |
| `attribution` | The referral's affiliate is the one credited | PENDING | — | — | — |  |
| `commission` | Amount, currency, hold and rule text correct | PENDING | — | — | — |  |
| `renewal` | Second cycle → same customer, same attribution, no reference | PENDING | — | — | — |  |
| `fullRefund` | Full refund → reversal, original *Revertida* if unpaid | PENDING | — | — | — |  |
| `partialRefund` | Partial refund(s) → proportional, cumulative reversal | PENDING | — | — | — |  |
| `dispute` | Chargeback/dispute → reversal | PENDING | — | — | — |  |
| `duplicateWebhook` | Redelivery → `duplicate`, nothing doubled | PENDING | — | — | — |  |
| `invalidSignature` | Tampered/unsigned delivery → refused, nothing recorded, rejection visible | PENDING | — | — | — |  |
| `testLiveIsolation` | Test event on a live connection (or reverse) → `TEST_LIVE_MISMATCH` | PENDING | — | — | — |  |
| `disconnect` | Disconnect → new events refused, ledger kept, provider webhook removed when supported | PENDING | — | — | — |  |
| `reconnect` | Reconnect → events flow again, no duplicate connection | PENDING | — | — | — |  |
| `multiAccount` | Two accounts in one workspace, events never cross | PENDING | — | — | — |  |
| `diagnostics` | Pipeline + reason correct for an organic and an attributed-without-commission payment | PENDING | — | — | — |  |
| `noSecretInLogs` | Server logs of the whole run contain no key, token, secret, payload or e-mail | PENDING | — | — | — |  |

Open questions: whether `refunds[]` is cumulative (parsed as cumulative);
queue interruption after 15 consecutive failures — confirm it surfaces.

---

## 6. Stripe — Stable (reference)

Stable before this ledger existed: public, in use, covered by the adapter,
route, `billing-events`, `ingest` and `plan-journey` DB suites. Listed in
`STABLE_BEFORE_LEDGER`.

Open item, explicit: **Connect OAuth real round trip — NOT_STARTED.** The
development environment has no platform Connect client configured
(`STRIPE_CONNECT_CLIENT_ID` empty), so the *Autorizar no Stripe* button is not
offered there; the round trip also requires the account owner to authorize on
Stripe. To run: set the platform client id, authorize a test-mode account,
confirm the connection is created `connected` with `acct_…`, events arrive on
the platform Connect endpoint and a second authorization of the same account
reuses the row.

Manual setup (this round): a setup started and not finished stays visible as
*Configuração incompleta* and resumes at the missing step — see
`INTEGRATION_STABILIZATION_REPORT.md`.
