# BILLING_PROVIDER_MATRIX.md

What each billing provider actually offers a read-only connector, from the
**official documentation as of 2026-09-18**. Where the docs are silent the cell
says **not documented** and the connector does not rely on it. Stripe facts are
the ones verified in `INTEGRATION_ARCHITECTURE_AUDIT.md` (SDK `stripe@22.6.2`,
API `2026-08-26.dahlia`).

Sources (fetched for this document):
- Stripe: docs.stripe.com (webhooks, Connect OAuth, Checkout, Payment Links) — see `INTEGRATION_ARCHITECTURE_AUDIT.md` §5.
- Mercado Pago: `mercadopago.com.br/developers/en/docs/your-integrations/notifications/webhooks`, `…/notifications/additional-info`, `…/docs/security/oauth/creation`, `…/reference/authentication/oauth/_oauth_token/post`, `…/reference/online-payments/checkout-api-payments/get-payment/get`, `…/create-refund/post`, `…/chargebacks/get-chargeback/get`, `…/checkout-pro-preferences/create-preference/post`, `…/subscriptions/get-authorized-payment/get`.
- AbacatePay (API v2): `docs.abacatepay.com/pages/authentication`, `…/pages/webhooks`, `…/pages/webhooks/create`, `…/pages/webhooks/security`, `…/pages/webhooks/events/checkout`, `…/pages/webhooks/events/subscriptions`, `…/pages/payment/refund`, `…/pages/devmode`, `…/pages/changelog/index`.
- Asaas (API v3): `docs.asaas.com/docs/autenticação-1`, `…/docs/chaves-de-api`, `…/reference/criar-novo-webhook`, `…/docs/sobre-os-webhooks`, `…/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook`, `…/docs/webhook-para-cobrancas`, `…/docs/eventos-para-assinaturas`, `…/reference/recuperar-uma-unica-cobranca`, `…/reference/estornar-cobranca`, `…/reference/rate-e-quota-limit`, `…/docs/ips-oficiais-do-asaas`.

---

## 1. Matrix

| Capability | Stripe | Mercado Pago | AbacatePay | Asaas |
| --- | --- | --- | --- | --- |
| **OAuth** | Yes — Connect OAuth, `scope=read_only`, returns `acct_…`; no token kept | Yes — authorization code (+ optional PKCE), `access_token` 180 d, `refresh_token` 6 m, returns `user_id`. Needs a platform MP application | **No** (Bearer key only) | **Not documented** |
| **API key** | Not needed (we never hold one) | Access token `APP_USR-…` (prod) / `TEST-…` | `abc_prod_…` / `abc_dev_…`, per-key scopes | `$aact_prod_…` / `$aact_hmlg_…`, **no read-only scope**, disabled after 3 months unused |
| **Webhooks** | Yes | Yes (panel per application, or `notification_url` per resource) | Yes | Yes |
| **Register webhook via API** | Yes (`POST /v1/webhook_endpoints`) but needs the merchant's **secret key** — rejected; OAuth + platform Connect endpoint instead | **Not documented** (panel only) | **Yes** — `POST /v2/webhooks/create` `{name, endpoint, secret, events[]}` | **Yes** — `POST /v3/webhooks` `{url, events[], authToken, sendType, apiVersion}`; max 10 per account |
| **Delivery authentication** | HMAC-SHA256 `Stripe-Signature` (`t=`,`v1=`) with endpoint `whsec_` | HMAC-SHA256 hex over `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` in `x-signature` (`ts=…,v1=…`), secret per application | Query `?webhookSecret=` (ours) **and** `X-Webhook-Signature` = base64 HMAC-SHA256(raw body) with a **global public key** | Header `asaas-access-token` = the `authToken` we set. **No HMAC** |
| **Replay protection** | Timestamp tolerance (300 s) | `ts` — tolerance up to the receiver | **None documented** | **None documented** |
| **Retries** | Up to 3 days, exponential | Every 15 min, growing, no stated cap; 200/201 within 22 s | 7 attempts over ~18 h; `410` **disables the webhook** | Not documented; queue **interrupted after 15 consecutive failures**, events kept 14 d |
| **Event id / idempotency** | `evt_…`, globally unique | Notification `id` "unique"; global uniqueness across sellers not stated | `log_…`, same on every retry | `evt_…` (may contain `&`), at-least-once |
| **Payload** | Full object | **Thin** — `data.id`; fetch `GET /v1/payments/{id}` | Full (`data.checkout`, `data.payment`, …) | Full `payment` object |
| **Customer identifier** | `cus_…` | `payer.id` (MP user id, number) | `cust_…` | `cus_…` |
| **Subscription identifier** | `sub_…` | preapproval id; `/authorized_payments/{id}` invoices carry `preapproval_id` | `subs_…` | `sub_…` (on each payment as `subscription`) |
| **Payment identifier** | `in_…` / `pi_…` / `ch_…` | payment id (number) | `bill_…` (checkout), `char_…` | `pay_…` |
| **Checkout identifier** | `cs_…` | preference id | `bill_…` | `checkoutSession`, `paymentLink` |
| **External reference** | `client_reference_id` (≤ 200, `[A-Za-z0-9_-]` for Payment Links) | `external_reference` ≤ **64**, `[A-Za-z0-9_-]` | `externalId` (returned in webhooks) | `externalReference` (Checkout ≤ 200; payment length not documented) |
| **Metadata** | Yes, returned | Yes (`metadata`, returned on the payment) | Accepted on create since 2026-03, **not shown in webhook payloads** | **None** |
| **Recurring billing** | Yes | Yes (preapproval) | Yes (`subscription.completed/renewed/cancelled`) | Yes (each cycle is a new payment with `subscription`) |
| **Full refund** | `refund.created` | payment `status=refunded` | `checkout.refunded` / `transparent.refunded` | `PAYMENT_REFUNDED` |
| **Partial refund** | `refund.created` per refund | `status_detail=partially_refunded`, **cumulative** `transaction_amount_refunded` | **No** ("reembolso total apenas") | `PAYMENT_PARTIALLY_REFUNDED`, `refunds[]` (treated as cumulative) |
| **Chargeback / dispute** | `charge.dispute.created/closed` (won restores) | `status=charged_back`, `topic_chargebacks_wh` | `*.disputed`, `*.lost`; **no "won" event** | `PAYMENT_CHARGEBACK_REQUESTED` (+ informational states) |
| **Subscription cancel** | `customer.subscription.deleted` | preapproval `status=canceled` | `subscription.cancelled` | `SUBSCRIPTION_INACTIVATED` / `SUBSCRIPTION_DELETED` |
| **Failed payment** | (not used for money) | `status=rejected` | `subscription.payment_failed` (announced; not in the create-webhook list) | `PAYMENT_OVERDUE`, `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED`, `PAYMENT_REPROVED_BY_RISK_ANALYSIS` |
| **Money in** | `invoice.paid`, `payment_intent.succeeded` | `status=approved` | `*.completed`, `subscription.completed/renewed` | **first of** `PAYMENT_CONFIRMED` / `PAYMENT_RECEIVED` per `pay_…` (Pix sends only RECEIVED; card/boleto send both) |
| **Test / live** | `livemode` on every event | `live_mode` on notifications and payments; **test-credential payments send no notifications** (panel simulator only) | `devMode` on payload; key prefix | Separate host + key prefix; payload has no flag → the connection's environment decides |
| **Sandbox** | Test mode | Test users, test cards (`APRO`…) | Dev mode | `api-sandbox.asaas.com` |
| **Currency** | Any, `currency` field | `currency_id` (BRL, ARS, MXN…) | BRL only (no field on checkout) | BRL only (no field) |
| **Amounts** | Integer minor units | **Decimal** `transaction_amount` | Integer centavos | **Decimal** `value` |
| **Multi-account** | One `acct_…` per connection; Connect routes by `event.account` | OAuth: `user_id` on each notification; manual: one application per merchant | One key per merchant; global HMAC key cannot tell merchants apart → per-connection URL secret | One key per account; per-connection `authToken` |
| **Rate limits** | Generous; not a concern for read-only use | Not documented (429 exists) | Not documented (429 exists) | 25 000 req / 12 h per account; 50 concurrent GETs |

## 2. Consequences for the connectors

| Provider | Connection method chosen | Webhook | Attribution transport (`checkoutFields`) | Status |
| --- | --- | --- | --- | --- |
| **Stripe** | Connect OAuth (when `STRIPE_CONNECT_CLIENT_ID` set) or `acct_…` + endpoint `whsec_` (unchanged) | OAuth: automatic (platform Connect endpoint). Manual: 1 endpoint per mode | `client_reference_id` + `metadata[indicafluxo_ref]`, `metadata[indicafluxo_customer]` | **public** |
| **Mercado Pago** | Paste access token + webhook secret (OAuth designed, not built — needs a platform MP application that does not exist) | **Manual**: add our URL and topics in the MP panel, paste the signature secret | `external_reference` = token; `metadata.indicafluxo_ref` + `metadata.indicafluxo_customer` | **beta** |
| **AbacatePay** | Paste API key | **Automatic**: we call `POST /v2/webhooks/create` with our per-connection secret | `externalId` = token (only field echoed in webhooks) | **beta** |
| **Asaas** | Paste API key | **Automatic**: we call `POST /v3/webhooks` with our per-connection `authToken` | `externalReference` = token (set on the payment or the subscription) | **beta** |

"Beta" means: implemented, contract-tested against sanitized fixtures built
from the documented payloads, **not yet round-tripped against a real account**.
The UI labels it, the public site and SEO pages do not mention it (brief §71).

## 3. Honest effort labels (what the UI says)

| Provider | Label |
| --- | --- |
| Stripe (OAuth configured) | Setup automático |
| Stripe (manual) | 2 etapas no Stripe |
| Mercado Pago | 2 etapas no painel do Mercado Pago |
| AbacatePay | Chave de API · webhook automático |
| Asaas | Chave de API · webhook automático |

## 4. Known capability gaps surfaced in the product

| Provider | Gap | Product behaviour |
| --- | --- | --- |
| Mercado Pago | No webhook registration API; test-credential payments send no notifications | Connect dialog lists the 2 panel steps; test strategy = panel simulator (documented in the dialog) |
| AbacatePay | No partial refund; no dispute-won; global HMAC key; secret in query string | Capability table shows "—"; both checks mandatory; URLs never logged |
| Asaas | No HMAC; no read-only key; key disabled after 3 months unused | Constant-time token check; UI advises a dedicated key; health turns "action required" on auth failure |
| All three | No refunds-per-refund id | Refunds carried as a **cumulative** amount; the ledger records the delta (`<payment>:refund:<cumulative>`) — idempotent by construction |

## 5. Priority order

The brief's order (Stripe → Mercado Pago → AbacatePay → Asaas) is **kept** for
the roadmap, but by setup friction the research ranks them
**Asaas ≈ AbacatePay (key + automatic webhook) < Mercado Pago (key + secret +
2 panel steps + fetch per notification)**. All three were built in this phase
behind the same contract suite, so the order only decides which one leaves
beta first; the recommendation is AbacatePay/Asaas first (fewer manual steps),
Mercado Pago once a platform OAuth application exists.
