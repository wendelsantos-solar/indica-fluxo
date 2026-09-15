# Docs technical findings

Every claim and sample in the integration guide (`/pt-br/documentacao`,
`/en/docs`) was checked against the code that implements it. Where the old
guide and the code disagreed, the difference is recorded here. The guide now
describes what the code does; behaviour was **not** changed to make the guide
look right.

Classification: **DOC_WRONG** — the guide was wrong or incomplete ·
**IMPLEMENTATION_WRONG** — the code does not do what a founder needs or what the
product tells them · **UNCLEAR** — needs a decision or verification against
Stripe.

| # | Class | Severity | Finding | Evidence | What the guide does now |
| --- | --- | --- | --- | --- | --- |
| T1 | IMPLEMENTATION_WRONG | **High** | **A founder cannot receive Stripe webhooks with the flow the product describes.** Verification uses one platform-wide `STRIPE_WEBHOOK_SECRET`, and the workspace is resolved from `event.account`, which Stripe only sets on events from accounts connected to the platform through Stripe Connect. Integrations asks the founder to type an `acct_…` id (no Connect OAuth) and to add the webhook URL in their own Stripe dashboard. An endpoint created there is signed with *its own* secret, which IndicaFluxo does not know → `invalid_signature`. Without `event.account`, `workspaceForProviderAccount` falls back to "the only connected workspace", so it works only when exactly one workspace is connected (the dev/demo setup). | `src/lib/billing/stripe/adapter.ts` (`verifyWebhook`, `providerAccountId: event.account`), `src/server/services/billing-events.ts` (`workspaceForProviderAccount`), `src/features/integrations/stripe-panel.tsx`, `forms.stripe.thenAdd` | Describes the steps exactly as the Integrations page asks (account id, then webhook URL). Not rewritten to invent a Connect flow that does not exist. **Fix needed:** either Stripe Connect OAuth + a platform Connect webhook (and remove "add this URL in Stripe" from the founder's steps), or per-workspace webhook signing secrets stored encrypted on the integration. |
| T2 | DOC_WRONG | High | The old guide never said where `visitorId` comes from, though identify requires it — the founder had no way to complete step 2 without reading the tracker source. | `src/lib/tracking/script.ts` writes `_referral_id` via `document.cookie` and exposes `window.Referral.visitorId` | New "De onde vem o visitorId" subsection: read the `_referral_id` cookie on the same domain, or send `window.Referral?.visitorId` with the sign-up form |
| T3 | DOC_WRONG / IMPLEMENTATION_WRONG | High | `providerCustomerId` is optional in the identify contract but a Stripe payment finds the affiliate **only** through it (`findAttribution(tx, workspaceId, event.providerCustomerId, null)`). Identify without it records the customer but no payment will ever earn a commission. | `src/lib/api/contract.ts`, `src/server/services/billing-events.ts` (`recordPayment`) | Field table marks it "necessário para gerar comissão"; warning callout explains re-calling identify with the same `externalId` once the Stripe customer exists. **Decide:** make it required for `provider: "stripe"`, or also match payments by `externalId` / e-mail hash |
| T4 | DOC_WRONG | Medium | The event list was incomplete: the adapter also handles `invoice.paid`, `payment_intent.succeeded` (one-off payments) and `customer.subscription.created`. | `src/lib/billing/stripe/adapter.ts` | The table is generated from `STRIPE_HANDLED_EVENTS`; a test compares it with the adapter's `case` labels |
| T5 | DOC_WRONG | Low | The tracker reads the referral code from `ref`, `via` **or** `aff`; the guide only mentioned `?ref=`. | `REF_QUERY_PARAMS` in `src/lib/tracking/constants.ts` | Listed, generated from the constant |
| T6 | UNCLEAR | Medium | `charge.dispute.created` creates a reversal whose parent transaction id is the **charge** id, while subscription payments are recorded under the **invoice** id. A dispute on an invoice payment may not find the original commission to reverse. `charge.refunded` uses `charge.invoice`, which newer Stripe API versions no longer include on charges. | `src/lib/billing/stripe/adapter.ts` (refund/dispute cases), `recordRefund` | Guide says refunds and disputes reverse the commission (the intended behaviour). Needs verification with real Stripe test events |
| T7 | UNCLEAR | Low | identify accepts `provider: "paddle" | "manual"`, but only Stripe is integrated; a `paddle` customer can never be matched by a Stripe webhook. | `src/lib/api/contract.ts` | Documents `provider` as optional, default `stripe`, "o único integrado hoje" |
| T8 | IMPLEMENTATION_WRONG | Low | identify error responses include `message` in English (`"Invalid API key."`); the product otherwise avoids English strings. Harmless for a server-to-server API, but inconsistent. | `src/app/api/identify/route.ts` | The guide documents only the stable `error` codes |
| T9 | DOC_WRONG | Low | The old sample used `https://app.example.com`; a copied snippet pointed nowhere. | old `docs/page.tsx` | Samples use the deployment's own origin (`NEXT_PUBLIC_APP_URL`) |
| T10 | UNCLEAR | Low | A comment in `api/track/route.ts` says its `Set-Cookie` keeps the visitor id "first-party" — that cookie is set on the IndicaFluxo host, not the customer's site, unless the endpoint is proxied. The real first-party cookie is the one the tracker writes with JavaScript. | `src/app/api/track/route.ts` | The guide describes the tracker's own cookie only |
| T11 | DOC_WRONG | Low | `generateApiKey`'s doc comment says "32 random bytes"; the code uses 24. Not user-facing. | `src/lib/crypto/hash.ts` | Not mentioned |

## Checked and correct

- Tracker tag: `<script defer src="…/t.js" data-key="pk_live_…">` — path from `TRACKER_PATH`, attribute read with `getAttribute("data-key")` (tested).
- Cookie `_referral_id`, 365 days, `SameSite=Lax`, `Secure` on HTTPS; no request without a code in the URL.
- identify: `POST /api/identify`, `Authorization: Bearer` secret key only, no CORS, body schema (the example is parsed against the real schema in tests), response `{ ok, customerId, attributionsBound }`, 120 requests/minute per IP.
- Webhook path `/api/webhooks/stripe`; idempotency by `(provider, provider_event_id)`.
- Commission: 4 900 × 3 000 bps = 1 470 (the example is computed with `applyBasisPoints`, tested); half-up rounding; no commission when the participation is not approved, the currency differs from the program, the first payment is outside the attribution window, or renewals exceed the duration.
- Defaults quoted (last click, 60-day window, 30-day hold) are the new-program form defaults.
- Error codes and statuses listed are the ones the routes return.
