# Plan & feature audit

**Rule of this document:** the landing page is not evidence. A benefit is only
listed as available when the code proves it. Section A is the audit of the code
as it stood at commit `0e9157f`, written before any change. Section B records
what was done about each row.

Status vocabulary: **IMPLEMENTED** · **PARTIAL** · **NOT_IMPLEMENTED** ·
**NOT_GATED** (exists, but the plan does not control it) · **BROKEN** (exists and
misbehaves) · **UNVERIFIED** (cannot be proven from code and tests alone).

Columns: Backend = server-side logic exists · Gating = enforced server-side by
plan · UI = reachable in the product · Tests = automated coverage of the
behaviour (not of helpers around it).

---

## A. Audit — before changes (`0e9157f`)

### A1. Plans, limits, billing

| Feature | Status | Backend | Gating | UI | Tests | Plan (then) | Evidence / observation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Plan model | PARTIAL | ✅ | — | ✅ | pure only | starter / growth | `workspaces.plan` enum (0006), `src/lib/plans.ts`. Only two plans, no sandbox/launch/scale |
| Self-upgrade protection | IMPLEMENTED | ✅ | — | — | ❌ | — | column grant excludes `plan` (0006) |
| Upgrade path | PARTIAL | ✅ | — | ✅ | ❌ | — | `plan_upgrade_requests` + operator SQL; no checkout, no inbox |
| Platform billing (IndicaFluxo charging workspaces) | NOT_IMPLEMENTED | ❌ | ❌ | ❌ | ❌ | — | no checkout, portal, subscription or billing webhook. `subscriptions` belongs to founders' customers |
| Trial / past_due / cancellation / downgrade | NOT_IMPLEMENTED | ❌ | ❌ | ❌ | ❌ | — | nothing models a workspace subscription state |
| Test / live environment | NOT_IMPLEMENTED | ❌ | ❌ | ❌ | ❌ | — | `livemode` never read; `test` key format accepted but never issued; a test-mode Stripe secret writes the real ledger |
| Program limit | PARTIAL | ✅ | ✅ services | ✅ | ❌ | starter 1 | `createProgram` asserts; archived programs count forever |
| Affiliate limit | PARTIAL | ✅ | ✅ services | ❌ notice | ❌ | starter 10 | counts every `affiliates` row incl. suspended; no limit notice |
| Member limit | PARTIAL | ✅ | ✅ services | ✅ | ❌ | starter 1 | pending invites never expire and count forever; undercounted for `member` role under RLS |
| Limits under concurrency | BROKEN | — | ❌ | — | ❌ | — | count-then-insert without lock; parallel creates both pass |
| **Limits via Supabase REST** | **BROKEN** | — | ❌ | — | ❌ | — | `authenticated` has INSERT/UPDATE/DELETE on every table and FOR ALL policies check only role (0001:178, 215–265): an owner/admin with their session can insert programs, affiliates, custom rates and invites directly |
| Custom affiliate rate | NOT_GATED in UI · PARTIAL | ✅ engine | ✅ services | ✅ shown on every plan | engine only | growth | UI offers it on Starter; fixed rate has no currency and silently re-denominates when the program currency changes |
| Team invites | PARTIAL | ✅ | ✅ | ✅ | pure only | growth | no expiry, no status column; claim by confirmed e-mail |
| Roles | BROKEN (REST) | ✅ services | — | ✅ | pure only | — | `workspace_members_admin_write` lets an admin promote themselves to owner via REST |
| Audit log | PARTIAL · BROKEN (REST) | ✅ | ✅ read | ✅ | ❌ | growth | `link.created`, `commission.*`, `api_key.revoked` never recorded; admins can UPDATE/DELETE rows via REST |
| Branding / custom domain | NOT_IMPLEMENTED | ❌ | — | ❌ | — | — | `workspaces.logo_url` unused |
| Outgoing webhooks / advanced API | NOT_IMPLEMENTED | ❌ | — | ❌ | — | — | only `/api/track`, `/api/identify` |
| API keys | PARTIAL · BROKEN | ✅ | ❌ | ✅ | ❌ | all | revoked publishable keys still accepted by `/api/track` |

### A2. Core (must be in the first paid plan)

| Feature | Status | Backend | Gating | UI | Tests | Evidence / observation |
| --- | --- | --- | --- | --- | --- | --- |
| Referral capture (tracker, cookie, visitor id) | PARTIAL | ✅ | — | ✅ | helpers | works; script and `/api/track` untested; dead server `Set-Cookie`; `/t.js` can freeze a localhost endpoint at build |
| Click recording | PARTIAL | ✅ | — | ✅ | ❌ | code lookup is workspace-wide `limit(1)` though codes are unique per program; no bot filter |
| Attribution first/last click + window | IMPLEMENTED (click side) · PARTIAL (renewals) | ✅ | — | ✅ | domain | a later last-click can move an already-converted customer's renewals to another affiliate |
| Identify | BROKEN | ✅ | — | docs | schema only | 500 when Stripe created the customer first; re-identify nulls stored provider id and e-mail hash |
| Stripe customer-billing webhooks | BROKEN | ✅ | — | ✅ | route mocked, DB gated | a failed event is claimed and every Stripe retry returns `duplicate`: the event is lost; refund before payment is lost |
| Duplicate-commission protection | BROKEN | — | — | — | favourable order only | `payment_intent.succeeded` + `invoice.paid` (basil API) can create two commissions |
| Commission engine (percentage, fixed, recurring, hold) | IMPLEMENTED | ✅ | — | ✅ | ✅ thorough | program status not checked at payment time |
| Refunds / disputes → reversals | IMPLEMENTED · BROKEN with payouts | ✅ | — | ✅ | ✅ | reversals append; but payouts overwrite `reversed` (below) |
| Ledger append-only | BROKEN (REST) | ✅ app | — | — | — | admins can INSERT/UPDATE commissions via REST |
| Affiliate portal | IMPLEMENTED | ✅ | — | ✅ | helpers | rename/delete link matches by id only (an admin-affiliate can edit others' links); suspended affiliates can create links |
| Affiliate isolation (A ≠ B) | IMPLEMENTED · UNVERIFIED | ✅ RLS | — | — | ❌ | policies correct for reads; no isolation test |
| Payout batches | BROKEN | ✅ | — | ✅ | ❌ | `markBatchPaid` sets refunded commissions to `paid`; `cancelPayoutBatch` makes them `available` again (double payment); no row lock between cancel and mark paid; REST can DELETE paid batches |
| CSV export | IMPLEMENTED | ✅ | — | ✅ | ✅ | admin only, formula-safe |
| Analytics essentials | PARTIAL | ✅ | — | ✅ | ❌ | revenue, commissions, clicks, customers, conversion rate exist; "ready to pay" includes batched; funnel trials not limited to referred customers |
| Multi-workspace | IMPLEMENTED | ✅ | ❌ | ✅ | ❌ | unlimited free workspaces per user (not a bypass once live requires a subscription per workspace) |

### A3. Summary of the audit

- **Existed and worked:** commission engine, first/last-click attribution on
  clicks, hold, CSV export, affiliate portal reads, per-workspace Stripe endpoint.
- **Partial:** plan model (2 plans, operator-only upgrade), limits (not
  concurrency-safe, never freed), invites (no expiry), audit log (actions
  missing), analytics definitions.
- **Existed but not gated:** custom rates in the UI, direct REST writes to
  every gated table.
- **Broken, and core:** webhook retries, duplicate commissions, identify,
  payouts vs reversals, revoked publishable keys, REST bypass of the ledger and
  of roles.
- **Not implemented:** sandbox/test mode, platform billing, trial/past_due/
  cancellation handling, branding, custom domain, outgoing webhooks.

Consequence for pricing: no paid plan could honestly be sold on this code —
the core money path had loss and double-payment bugs, and every limit could be
bypassed. Fixing the core comes before plans; plans come before the landing.

---

## B. After the changes

Evidence is the code plus automated tests. DB tests run with `RUN_DB_TESTS=1`
against the dev database (every row they create is removed or rolled back):
`plan-enforcement.db`, `ledger-portal.db`, `ingest.db`, `sandbox.db`,
`billing-events.db`, `platform-billing.db`, `webhook-events.db`,
`analytics-environment.db` and the end-to-end journey `plan-journey.e2e.db`.

### B1. Plans, limits, billing

| Feature | Status | Backend | Gating | UI | Tests | Plan | How |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Plan model (sandbox/launch/growth/scale) | IMPLEMENTED | ✅ | — | ✅ | ✅ | all | `src/lib/plans.ts`; `workspace_subscriptions` (no row = Sandbox); `resolveEntitlements` |
| Entitlement API | IMPLEMENTED | ✅ | ✅ | — | ✅ | — | `services/entitlements.ts`: `getWorkspaceEntitlements`, `canUseFeature`, `assertFeature`, `assertLiveMode`, `assertWithinLimit` |
| Typed plan errors | IMPLEMENTED | ✅ | ✅ | ✅ upgrade prompt | ✅ | — | `PLAN_LIMIT_REACHED`, `FEATURE_NOT_AVAILABLE`, `LIVE_MODE_REQUIRED`, `SUBSCRIPTION_REQUIRED` (402) |
| Test / live environment | IMPLEMENTED | ✅ | ✅ liveMode | ✅ switch | ✅ | live: Launch+ | `environment` on programs, keys, customers, transactions, batches, events; key/`livemode` routing |
| Sandbox simulation | IMPLEMENTED | ✅ | test programs only | ✅ dialog | ✅ | all | `services/sandbox.ts` through the real pipeline |
| Platform billing (Checkout, Portal, webhook) | IMPLEMENTED · UNVERIFIED against live Stripe | ✅ | owners/admins | ✅ Settings | ✅ signed payloads, mocked Stripe API | Launch/Growth | `lib/platform-billing/stripe`, `/api/platform-billing/stripe/webhook`, `services/platform-billing.ts` |
| past_due / grace / restricted | IMPLEMENTED | ✅ | ✅ | ✅ banner | ✅ | — | 7-day grace, then no live processing and no creation |
| Cancellation / downgrade / over-limit | IMPLEMENTED | ✅ | ✅ | ✅ Settings | ✅ e2e | — | nothing deleted; `overLimits`; creation blocked |
| Program limits (live/test) | IMPLEMENTED | ✅ | ✅ | ✅ | ✅ | 0/1 · 1/1 · ∞ | create + restore archived, advisory lock |
| Affiliate limit | IMPLEMENTED | ✅ | ✅ | ✅ notice | ✅ (101st) | 10 · 100 · ∞ | invite + approve/reactivate; counting rule in SQL |
| Member limit + expiring invites | IMPLEMENTED | ✅ | ✅ | ✅ | ✅ (3rd, 11th) | 1 · 2 · 10 | 14-day expiry; resend renews |
| Limits under concurrency | IMPLEMENTED | ✅ | ✅ | — | ✅ race test | — | `pg_advisory_xact_lock` per workspace+limit |
| REST (Data API) bypass | FIXED | ✅ | ✅ | — | ✅ verified | — | migration 0009: app role `indica_app`; `authenticated`/`anon` hold no privileges |
| Custom affiliate rate | IMPLEMENTED | ✅ | ✅ | ✅ hidden + prompt | ✅ | Growth | existing rates keep applying after downgrade; can be cleared |
| Audit log | IMPLEMENTED | ✅ | ✅ read | ✅ | ✅ | Growth | immutable for the app role; `link.created`, `api_key.revoked`, member actions recorded |
| Roles (admin → owner escalation) | FIXED | ✅ | — | ✅ | ✅ | — | services only path; members may leave (0012) |
| API keys | IMPLEMENTED | ✅ | live keys need liveMode | ✅ | ✅ | — | revoked keys rejected everywhere |
| Branding / custom domain / outgoing webhooks / advanced API | NOT_IMPLEMENTED | — | — | — | — | Scale (future) | deliberately not built; not advertised |

### B2. Core

| Feature | Status | Tests | How |
| --- | --- | --- | --- |
| Referral capture + click recording | IMPLEMENTED | ✅ script, ingest, e2e | environment-scoped code lookup, codes unique per workspace, revoked keys rejected, `/t.js` posts to its own origin |
| Attribution + renewal lock | IMPLEMENTED | ✅ | a bound attribution keeps its affiliate; attribution writes serialised |
| Identify | IMPLEMENTED | ✅ | no 500 when Stripe created the customer first; never nulls stored ids; environment-scoped |
| Stripe customer-billing webhooks | IMPLEMENTED | ✅ | failed events re-claimed on retry; early refunds retried; test/live secrets; live ignored-not-claimed without live mode |
| Duplicate-commission protection | IMPLEMENTED | ✅ both orders, redelivery, concurrent | per-payment advisory locks + `transaction_references` + `dup_` adjustment |
| Commission engine, recurring, hold | IMPLEMENTED | ✅ | unchanged rules; renewal commission verified end to end |
| Refunds / disputes | IMPLEMENTED | ✅ | reversals decided before participation gate; proportional |
| Payout batches | IMPLEMENTED | ✅ | per environment; reversed commissions never paid; cancel never resurrects; batch row locked |
| CSV export | IMPLEMENTED | ✅ | e2e checks the row |
| Affiliate portal + isolation | IMPLEMENTED | ✅ RLS isolation test | own links only; live balances separate from test programs |
| Analytics essentials | IMPLEMENTED | ✅ environment DB test | revenue nets refunds and ignores duplicates; ready-to-pay excludes batched; funnel counts referred customers |

### B3. Removed from the public pages

"Mais popular" (no popularity data — "Recomendado" instead), Starter plan,
struck-through feature lists, per-locale USD price, "Suporte prioritário",
"Retenção de dados estendida", "Múltiplos workspaces" (earlier pass), and any
claim of custom rates outside Growth. See `LANDING_CLAIMS_AUDIT.md`.

### B4. Known limits (documented, not hidden)

- Platform billing is verified with signed test payloads and a mocked Stripe
  API client, not against a real Stripe account (none is configured here).
- Refunds after a commission was paid are recorded as reversals but not clawed
  back from a later payout.
- Live events received while live mode is inactive are not stored; they must be
  re-sent from the Stripe dashboard after reactivation.
- Signed-in screens were verified by typecheck, unit/DB tests and route
  compilation, not by a signed-in browser session.
