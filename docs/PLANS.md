# PLANS.md

**Read this before changing plans, billing, limits, entitlements or pricing.**

The code is the source of truth for what a plan includes:
`src/lib/plans.ts` (capabilities, limits, prices), `src/server/domain/entitlements.ts`
(how a subscription becomes permissions), `src/server/services/entitlements.ts`
(the only gate services call). The pricing page renders from the same module.
If a benefit is not enforced or delivered by code, it is not listed.

---

## 1. Plans

| | Sandbox | Launch | Growth | Scale |
| --- | --- | --- | --- | --- |
| Price | free | R$ 99/month | R$ 197/month (recommended) | not sold |
| Public | yes (as the free start, not a commercial plan) | yes | yes | no |
| Live mode | **no** — test data only | yes | yes | yes |
| Live programs | 0 | 1 | unlimited | unlimited |
| Test programs | 1 | 1 | unlimited | unlimited |
| Affiliates | 10 | 100 | unlimited | unlimited |
| Members (incl. pending invites) | 1 | 2 | 10 | 10 |
| Custom rate per affiliate | — | — | yes | yes |
| Audit log (view) | — | — | yes | yes |

**Core in every plan** (Sandbox in test mode, Launch and Growth live): tracking
script and referral links, first/last-click attribution with window, identify
API, Stripe integration, commission ledger (percentage, fixed, recurring,
hold), refunds and disputes as reversals, affiliate portal, payout batches with
CSV export, essential analytics. Growth sells scale, team and control — never
access to the core.

**Scale** exists in the model (`plan_code`, `PLAN_CAPABILITIES.scale`) so a
third plan can be added without a migration. It stays `public: false` until
something exclusive exists (custom domain, advanced API/webhooks, granular
permissions, SLA). Do not invent features to fill it.

**Prices** live in `PLAN_OFFERS` (display) and in Stripe (charge), matched by
`STRIPE_LAUNCH_PRICE_ID` / `STRIPE_GROWTH_PRICE_ID`. All prices are BRL, the
currency Refvia bills in, in every locale.

**Why 100 affiliates on Launch and not unlimited:** the limit is what separates
a first program from an acquisition channel, and the counting rule (§3) makes it
a count of *active* relationships, which a first program rarely exceeds.

## 2. Test and live

`environment` (`test` | `live`) is carried by `programs` (and so by every click,
attribution, participation and commission under them), `api_keys`
(`pk_test_`/`sk_test_` vs `pk_live_`/`sk_live_`), `customers`, `transactions`,
`payout_batches` and `webhook_events`. There is no second database.

- A program's environment is chosen at creation and never changes. Going live
  means creating a live program (the form can copy a test program's settings).
  Nothing test is ever re-labelled live, so the live ledger holds only live money.
- Test keys only reach test programs; live keys only live programs. A Stripe
  event is routed by its `livemode`: test events to test programs, live events to
  live programs. The founder saves both signing secrets (test and live
  endpoints) on the same integration.
- **Live processing requires `liveMode`** (Launch/Growth in `active` or `grace`
  standing). Without it: `/api/track` ignores clicks for live programs,
  `/api/identify` with a live key answers `402 LIVE_MODE_REQUIRED`, live Stripe
  events are acknowledged but **not claimed** (no `webhook_events` row), so they
  can be re-sent from the Stripe dashboard after reactivation. Test processing
  works on every plan.
- Test programs can simulate a conversion without Stripe (click → identify →
  payment through the real services), for the Sandbox journey.
- The dashboard shows one environment at a time (Live / Test switch, cookie
  `if_env_<workspaceId>`, resolved by `src/lib/view-environment.ts`); a
  Sandbox workspace only has Test — unless it still holds live programs (after a
  downgrade), which stay readable. Payout batches are per environment; a test
  batch pays test commissions and moves no money.

## 3. Limits — counting rules

Defined once, in SQL: `public.workspace_plan_usage(workspace_id)` (migration 0010).

- **Programs:** not `archived`, counted per environment. Archiving frees a slot;
  restoring an archived program re-checks the limit.
- **Affiliates:** not `suspended`, with at least one `pending` or `approved`
  participation in the workspace. Rejecting or suspending frees a slot;
  approving again re-checks. Enrolling an existing affiliate in another program
  takes no new slot.
- **Members:** workspace members plus invitations not accepted and not expired
  (invitations expire after 14 days).

Enforcement: `assertWithinLimit(tx, workspaceId, entitlements, limit)` inside the
same transaction as the write, under a per-workspace advisory lock, so parallel
requests cannot both take the last slot. `null` = unlimited.

Paths that must check (and do): create program, restore archived program, invite
affiliate (new affiliate), approve/reactivate participation, invite member,
resend invite. Features: set/invite with a custom rate
(`customAffiliateRates`), read audit log (`auditLog`), anything live
(`assertLiveMode`).

The Supabase Data API cannot bypass this: the app runs as `indica_app`
(migration 0009); `authenticated` and `anon` hold no privileges on product tables.

## 4. Errors

| Code | Status | When |
| --- | --- | --- |
| `PLAN_LIMIT_REACHED` | 402 | a limit would be exceeded (`upgradeTo` = cheapest plan that fits, or null) |
| `FEATURE_NOT_AVAILABLE` | 402 | the plan lacks the feature (`upgradeTo`) |
| `LIVE_MODE_REQUIRED` | 402 | live data on a plan without live mode |
| `SUBSCRIPTION_REQUIRED` | 402 | past due beyond grace: creation and live processing stopped |

Message keys: `errors.plan.limit.<limit>`, `errors.plan.feature.<feature>`,
`errors.plan.liveModeRequired`, `errors.plan.subscriptionRequired`.

## 5. Billing (Refvia charging workspaces)

Two Stripe responsibilities, never mixed:

| | Customer billing | Platform billing |
| --- | --- | --- |
| Whose Stripe | the founder's | Refvia's |
| Purpose | detect the founder's customers' payments | charge Launch/Growth |
| Code | `src/lib/billing/stripe/`, `/api/webhooks/stripe/[integrationId]` | `src/lib/platform-billing/stripe/`, `/api/platform-billing/stripe/webhook` |
| Credentials | per-integration encrypted signing secrets | `PLATFORM_STRIPE_SECRET_KEY`, `PLATFORM_STRIPE_WEBHOOK_SECRET`, `STRIPE_LAUNCH_PRICE_ID`, `STRIPE_GROWTH_PRICE_ID` |
| Tables | `customers`, `subscriptions`, `transactions` | `workspace_subscriptions` |
| Idempotency | `webhook_events` scope `customer_billing` | `webhook_events` scope `platform_billing` |

- **No row in `workspace_subscriptions` = Sandbox.** A new workspace is Sandbox;
  no trial starts on sign-up.
- **Activate:** Settings → Plano e cobrança → choose Launch or Growth → Stripe
  Checkout (subscription mode, `client_reference_id` = workspace). The redirect
  back is not trusted; the webhook writes the subscription.
- **Change plan / card / invoices / cancel:** Stripe Billing Portal.
- **Webhook events handled:** `checkout.session.completed`,
  `customer.subscription.created|updated|deleted`, `invoice.paid`,
  `invoice.payment_failed`. The subscription row is updated from the Stripe
  subscription object; an event older than `provider_event_at` never overwrites
  a newer state.
- Owners and admins manage billing; members read the plan.
- Without the platform-billing environment variables, checkout is unavailable
  and Settings offers a manual request (`plan_upgrade_requests`) instead.

## 6. States

| Subscription | Effective plan | Live | Create | Notes |
| --- | --- | --- | --- | --- |
| none / `free` / `incomplete` | Sandbox | no | yes (Sandbox limits) | |
| `active`, `trialing` | subscribed plan | yes | yes | |
| `active` + `cancel_at_period_end` | subscribed plan until `current_period_end` | yes | yes | banner with end date |
| `cancelled` (or period ended) | Sandbox | no | Sandbox limits | nothing deleted |
| `past_due` < 7 days | subscribed plan | yes | yes | banner: update payment |
| `past_due` ≥ 7 days | subscribed plan, restricted | **no** | **no** | data readable; `SUBSCRIPTION_REQUIRED` |

**Downgrade (Growth → Launch, or to Sandbox):** nothing is deleted — programs,
affiliates, members, invitations, commissions stay. If usage exceeds the new
limits the workspace is **over limit**: everything remains visible, nothing new
of that kind can be created (and archived programs cannot be restored, pending
affiliates cannot be approved) until usage is back under the limit. Live
programs above the limit keep processing. Existing custom affiliate rates keep
applying to future commissions (changing earnings silently would be worse); they
can be removed but not set or changed. The audit log keeps recording; viewing
it needs Growth again.

**Existing data at migration 0010:** every workspace without an operator-granted
Growth became Sandbox; its programs, keys, customers, transactions and batches
were marked `live`, so live processing for those workspaces stops until they
subscribe. Operator-granted Growth became a `manual` active subscription.

## 7. Where to change what

| Change | Files |
| --- | --- |
| A limit or feature of a plan | `src/lib/plans.ts` + this file + tests in `src/lib/__tests__/plans.test.ts` |
| A new limit | `src/lib/plans.ts`, `public.workspace_plan_usage` (new migration), `repositories/plans.ts` |
| Grace period, state rules | `src/server/domain/entitlements.ts` + §6 |
| A price | `PLAN_OFFERS` **and** the Stripe Price behind the env var |
| Scale going public | only once it has exclusive, implemented capabilities |
