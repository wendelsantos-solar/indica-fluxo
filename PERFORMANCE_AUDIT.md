# PERFORMANCE_AUDIT.md

Performance audit of IndicaFluxo, frontend and backend, 2026-09-15.
Method: **measure → identify → prioritise → optimise → measure again**. Every
number here was measured during the audit; what could not be measured says so.

Contents: §0 environment · §1 baseline frontend · §2 baseline backend ·
§3 findings (P0–P4) · §4 database at scale · §5 changes · §6 before/after ·
§7 regression checks · §8 remaining bottlenecks · §9 when to scale · §10 how to
re-measure · §11 status.

---

## 0. Measurement environment — read before comparing numbers

| Item | Value |
| --- | --- |
| App | `pnpm build` + `next start -p 3100` (production build, Turbopack), local machine (Apple Silicon) |
| Database | Supabase Postgres 17.6, `aws-0-us-east-2` **session pooler** (5432), reached from São Paulo |
| DB round-trip time (`select 1`, warm) | p50 **140 ms** at the start of the audit, 162 ms later (drifts) |
| Fresh Postgres connection (TLS + pooler auth + `select 1`) | p50 **2 818 ms** (min 1 336, max 7 401, n=8) |
| Supabase Auth `/auth/v1/health` | p50 61 ms |
| Dev-DB volume | `referral_clicks` 908, `commissions` 64, `transactions` 64, `customers` 21, 3 workspaces |
| Browser (lab) | local Google Chrome headless over CDP: 412×915 mobile viewport, **4× CPU slowdown, 150 ms RTT / 1.6 Mbps**, cold profile per run, median of 7 (`scripts/perf/lab-vitals.mjs`) |

**What this means.** Backend latency here is dominated by the laptop↔us-east-2
RTT. In production the app and the database should share a region, so absolute
milliseconds will be far lower — but round trips and statements are the same
everywhere, so results are also given in statements. Because RTT drifted during
the day, backend before/after is measured **interleaved in one process**
(`pnpm perf:dashboard`), never as two runs hours apart. Frontend before/after is
an A/B of two production builds served side by side (the "before" build is the
same tree with the frontend changes reverted). No field data (RUM) exists, so
there is no real-user LCP/INP; INP could not be measured (no interaction script).

Dev-DB volume is tiny, so query plans at current volume say little. Index and
RLS decisions use a synthetic scale test inside a transaction that is always
rolled back (§4).

---

## 1. Baseline — frontend

### 1.1 Build and JavaScript

`pnpm build`: 25 s wall, 38 static pages. 50 JS chunks (1.5 MB raw), one CSS file
80 KB / **15.2 KB gzip**. Framework runtime on every route (`rootMainFiles`):
**127.1 KB gzip**. Route JS on top of it (gzip, from the client-reference manifests):

| Route | JS gzip | First load (gzip) |
| --- | --- | --- |
| dashboard `programs/[programSlug]` (heaviest) | 110.3 KB | 237 KB |
| dashboard `overview` | 104.6 KB | 232 KB |
| affiliate portal `overview` | 98.5 KB | 226 KB |
| docs | 90.0 KB | 217 KB |
| auth `login` | 88.1 KB | 215 KB |
| marketing `/` and `pricing` | 86.0 KB | 213 KB |

- Auth pages do **not** pull the dashboard shell: their chunks hold the root
  providers, `locale-switcher`, `theme-toggle` and the form only.
- The landing's only client leaf is `site-header` (scroll state, menu).
- Shiki runs server-side only (`features/docs/highlight.ts` is `server-only`); no
  highlighting code in any client chunk.
- 62 `"use client"` files; all are leaves (forms, dialogs, menus, the chart with
  hover, the shell). No layout or page is a client component. No raster images
  anywhere (`<img>`/`next/image`: none) and no third-party scripts.
- 19 `useMemo`/`useCallback`/`memo` uses; no profiling evidence of render cost,
  none added or removed.

### 1.2 HTML / RSC payload

| Page | HTML raw | HTML gzip | Font preloads |
| --- | --- | --- | --- |
| `/pt-br` (landing) | **306.7 KB** | **58.2 KB** | 4 |
| `/pt-br/precos` | 190.8 KB | 42.8 KB | 4 |
| `/pt-br/entrar` (login) | 159.6 KB | 40.9 KB | 0 |
| `/en/signup` | 154.4 KB | 39.4 KB | 0 |

Every page embedded dashboard-only strings (e.g. `readyToPay`): the root
`NextIntlClientProvider` had no `messages` prop, so next-intl serialised the
**whole catalogue** (pt-br 108 KB of JSON) into every page — and into every RSC
prefetch (landing: 11 prefetches, 350 KB decoded / 74 KB transferred).

Fonts preloaded on public pages: Inter (opsz) latin + latin-ext, JetBrains Mono
latin + latin-ext — **262 KB**.

### 1.3 Lab Web Vitals (mobile, throttled — §0)

| Page | FCP | LCP | CLS | load | transfer |
| --- | --- | --- | --- | --- | --- |
| `/pt-br` | 976 ms | 976 ms (hero `<h1>`) | 0.0257 | 2 987 ms | 631 KB |
| `/pt-br/entrar` | 900 ms | 900 ms | 0.0005 | 2 883 ms | 661 KB |

Already inside the targets (LCP < 2.5 s, CLS < 0.1).

---

## 2. Baseline — backend

### 2.1 Endpoints (serial `curl`, n=30 unless noted)

| Endpoint | p50 | p95 | max | Note |
| --- | --- | --- | --- | --- |
| `GET /pt-br` (static) | 3 ms | 4 ms | 5 ms | prerendered |
| `GET /pt-br/entrar` | 9 ms | 12 ms | 15 ms | no DB |
| `GET /t.js` | 1 ms | 2 ms | 4 ms | `max-age=3600, s-maxage=86400, immutable` |
| `POST /api/track`, invalid payload | 2 ms | 2 ms | 3 ms | rejected before I/O |
| `POST /api/track`, well-formed unknown key (n=20) | **454 ms** | 2 080 ms | 2 538 ms | one key lookup; tail = reconnects |
| `GET /api/health`, first call after > 20 s idle | — | — | **5 101 ms** | pool had closed its connection |
| `GET /api/health`, 10 concurrent on a cold pool | 3 980 ms | — | 6 121 ms | 10 connections opened at once |

### 2.2 Round-trip anatomy (raw postgres.js, n=10–15)

| Shape | p50 | Round trips |
| --- | --- | --- |
| `select 1` | 140 ms | 1 |
| parameterised `select … where key_hash = $1`, `prepare: false` (the app) | **285 ms** | **2** — Parse+Describe, wait, Bind+Execute |
| same, `prepare: true` on a raw tagged template | 140 ms | 1 — but see BE-2: Drizzle never gets this |
| `withUser` + 1 query (two separate `set_config`) | **720 ms** | 5+ |
| `withUser` + 4 queries awaited one by one (through Drizzle) | 1 163 ms | |
| `withUser` + 4 queries in `Promise.all` (Drizzle → postgres.js pipelines them) | 706 ms | |

### 2.3 Founder dashboard: one navigation (layout + overview), static count

- 2 Supabase Auth `getUser()` calls (proxy + page).
- **57 SQL statements** in **8 transactions**:
  - the layout: 4 sequential `withUser` blocks — workspaces, the same workspace
    again, participations + subscription, subscription again + live programs;
  - the page: re-read the workspace, integration health (6 reads, sequential),
    and the analytics transaction.
- The layout loaded every participation row to test `length > 0`.
- The subscription (`workspace_subscriptions`) was read 3× per navigation.

---

## 3. Findings

Format: problem · evidence · impact · cause · solution · risk · status.

### P0

**DB-1 — RLS policies run a lookup per scanned row.** *Fixed (migration 0013).*
- Evidence (300k clicks, 31k commissions, §4): 30-day click count **2 352 ms under
  RLS vs 96 ms without**. `integration health: last click` 7 038 ms,
  `listAffiliates` 8 663 ms, `getDashboardOverview` 5 638 ms.
- Impact: every founder page degrades linearly with ledger/click volume; the
  dashboard becomes unusable at a few hundred thousand clicks.
- Cause: policies call SECURITY DEFINER helpers with a row value
  (`is_workspace_member(program_workspace(program_id))`,
  `owns_participation(program_affiliate_id)`). SECURITY DEFINER functions are
  never inlined, so each scanned row runs a subquery; `FOR ALL` admin policies
  also apply to SELECT, adding a second call per row.
- Solution: set-returning helpers evaluated once per statement —
  `workspace_id IN (SELECT public.member_workspace_ids())`, etc.
- Risk: authorisation drift. **Proven equal**: each rewritten predicate
  compared with the old one on every row of every rewritten table, for every
  user in the dev DB plus a stranger — 5 users × 25 predicates, **509 750 row
  checks, 0 mismatches**. The DB-backed suites pass (§7).

### P1

**BE-1 — Too many sequential round trips per dashboard navigation.**
*Partly fixed.*
- Evidence: §2.3; `withUser` + 1 query = 5 round trips.
- Cause: one `set_config` per setting; duplicate reads between layout, page and
  `getViewEnvironment`; independent reads awaited one by one.
- Solution:
  - one combined `set_config` statement;
  - `cache()` on `getWorkspaceForUser` / `listUserWorkspaces`;
  - a cached `getWorkspaceStanding` shared by the layout and `getViewEnvironment`;
  - `userHasParticipation` (LIMIT 1) instead of loading all participations;
  - `Promise.all` for independent reads (separate connections across
    transactions, pipelined inside one).
- Risk: low. Authorisation is still checked first (`requireMembership` stays
  awaited before the pipelined reads); RLS unchanged.

**BE-2 — Every parameterised statement costs two round trips.**
*Fixed in §12 — driver switched to node-postgres.*
- Evidence: 285 ms vs 140 ms for a raw postgres.js query (§2.2); `track-reject`
  p50 288 ms against `health` 146 ms under load (§6.3).
- Cause: postgres.js sends an unnamed statement with parameters as
  Parse+Describe, waits for the description, then Bind+Execute. Drizzle's
  postgres-js driver runs **every** query — including `.prepare()`d ones —
  through `client.unsafe(query, params)`, and `unsafe` forces `prepare: false`
  (`postgres/src/index.js:122`, `drizzle-orm/postgres-js/session.js`).
- So the pool's `prepare` option does nothing for this app. Measured:
  `BENCH_PREPARE=1` gives the same dashboard latency as the default (§6.2).
- What would work, in order of preference:
  - co-locate app and database: at ~1 ms RTT the second round trip is noise
    (the real fix);
  - pipeline independent statements (done where it was safe, BE-1);
  - only if an ingest path still shows it in-region: a raw postgres.js tagged
    template with `prepare: true` for that one lookup (e.g. the publishable-key
    lookup in `/api/track`). It needs a session pooler or a direct connection,
    and a documented exception to "SQL lives in repositories via Drizzle".

**BE-3 — Connection setup is multi-second, and the pool drops idle connections after 20 s.**
*Not changed — recommendation.*
- Evidence: fresh connection p50 2.8 s (max 7.4 s); first request after idle
  5.1 s; 10 concurrent cold requests 4–6 s each (§2.1).
- Impact: a founder returning after 20 s, or any traffic burst on a new
  serverless instance, pays seconds before the first query. Up to 10 connections
  per instance against a pooler with a fixed pool size is a connection-storm risk.
- Solution, once the deploy target is known:
  - long-lived server: raise `idle_timeout` (e.g. 300 s);
  - serverless (e.g. Vercel): keep `max` low (2–3) per instance;
  - co-locate the function region with `us-east-2`;
  - consider the transaction pooler (the app already sends unnamed statements,
    see BE-2; `withUser` uses transaction-local `set_config`, which works there).

**FE-1 — The whole message catalogue shipped on every page.** *Fixed.*
- Evidence: §1.2.
- Solution: each route group's layout passes only the namespaces its client
  components read (`src/i18n/client-namespaces.ts`, `clientMessages()`).
  `src/i18n/__tests__/client-namespaces.test.ts` walks each scope's import graph
  and fails if a `useTranslations` call reads a message the scope does not ship,
  since a missing message renders as its key path.
- Risk: a future client component in a scope whose list lacks its namespace —
  caught by that test.

### P2

**FE-2 — 262 KB of fonts preloaded.** *Fixed.*
- Cause: next/font preloads every listed subset, but all subsets are self-hosted
  with `unicode-range` anyway. Portuguese accents are Latin-1, inside `latin`.
- Solution: `subsets: ["latin"]` for both families. Other glyphs still load on
  demand. Preloaded bytes: 262 → 111 KB.

**DB-2 — Refund/dispute ingest scans every tenant's commissions.** *Fixed (index 0014).*
- Evidence: `reversal_of_commission_id = $1` → Seq Scan (4.5 ms at 31k rows,
  linear, inside the webhook transaction, with no workspace filter).
- Index: `commissions (reversal_of_commission_id) WHERE reversal_of_commission_id IS NOT NULL`
  → Index Scan, < 0.1 ms. Partial, so the write cost falls only on reversal rows.

**DB-3 — The commissions list sorts the whole workspace ledger.** *Fixed (index 0014).*
- Evidence (after DB-1): `listCommissions` page 1 took 141 ms → **29 ms** with
  `commissions (workspace_id, created_at DESC, id)`.

**DB-4 — Payment → customer fallback by e-mail hash scans all customers.** *Fixed (index 0014).*
- Evidence: Seq Scan on `customers` across tenants.
- Index: `customers (workspace_id, environment, email_hash) WHERE email_hash IS NOT NULL`.

**BE-4 — Two Supabase Auth network calls per authenticated navigation (proxy + page).**
*Fixed in §12 — pages verify the JWT locally after the proxy's `getUser()`.*
- `getClaims()` (local JWT verification) would remove one, but it does not see
  server-side session revocation. That is a security trade-off, not a
  performance fix. Measured cost: ~60 ms each from here; less in-region.

**DB-5 — `listAffiliates` computes five correlated aggregates per row before LIMIT.**
*Remaining.*
- Evidence: 312 ms at scale after DB-1, dominated by `Sort(30065)` over
  commissions.
- Fine now. Rewrite to pre-aggregated CTEs when a workspace has more than ~5k
  affiliates or more than ~500k commissions.

### P3

- **Tracking ingest is 7–8 sequential statements** (`recordClick`: live-mode
  check, participation lookup, optional link lookup, insert, advisory lock,
  `SELECT … FOR UPDATE`, upsert).
  - Correct by design (the lock order protects attribution).
  - In-region RTT makes it a few ms. From here, each is two round trips (BE-2).
  - Do not pipeline across the lock.
- **Command palette and Radix dialog load eagerly** in the dashboard shell.
  - Dashboard route JS is ~105 KB gzip.
  - No INP evidence; left as is (lazy-loading without a measured problem is not a fix).
- **Correctness (not performance)**: the portal overview filters payouts to
  `live` after `LIMIT 100`. Flagged as a separate task.

### P4 / confirmed fine

- `force-dynamic` appears only on authenticated or cookie-reading routes, which
  are dynamic anyway. No user data is cached across requests; `cache()` is
  per-request.
- Commission engine (`server/domain/commission.ts`): pure, no I/O. Context is
  loaded once by `billing-events.ts`.
- Stripe webhook:
  - signature is verified before parsing;
  - the idempotency claim is kept;
  - ~18–22 statements per commissioned payment, intentionally transactional.
  - Unchanged: financial consistency outranks latency.
- `/api/track` logs only at `debug` (off in production) and never the payload;
  `/api/identify` logs counts, never the e-mail.
- Rate limit: an O(1) in-process token bucket — cheap, but per instance (§9).

---

## 4. Database at scale (synthetic, rolled back)

`pnpm perf:explain` inserts, inside one transaction that is always rolled back:
- 300 908 clicks
- 10 021 customers
- 30 064 payments
- 30 973 commissions, including reversals

It then runs the real repositories as the workspace owner under RLS and
EXPLAIN ANALYZEs every captured statement (server execution time; the sum over
a function's statements).

| Query | Before (0012 policies) | After 0013 | After 0013 + 0014 |
| --- | --- | --- | --- |
| `getDashboardOverview` | 5 638 ms | **405 ms** | |
| `getRevenueSeries` | 1 308 ms | 108 ms | |
| `getConversionFunnel` | 3 092 ms | 157 ms | |
| `getTopAffiliates` | 624 ms | 146 ms | |
| `listConversions` page 1 | 2 600 ms | 182 ms | |
| `listCommissions` page 1 | 2 318 ms | 141 ms | **29 ms** |
| `listAffiliates` page 1 | 8 663 ms | 312 ms | |
| `listAffiliates` sort=commission | 8 026 ms | 323 ms | |
| integration health: last click | 7 038 ms | 198 ms | |
| clicks in 30 days | 2 352 ms (no RLS: 96 ms) | 145 ms | |
| ingest: reversals of a commission | 4.5 ms, Seq Scan | | < 0.1 ms, Index Scan |
| ingest: customer by e-mail hash | 1.8 ms, Seq Scan | | < 0.1 ms, Index Scan |

Indexes considered and **not** created:
- `(program_id, attributed_at)` on attributions and `(workspace_id, started_at)`
  on subscriptions: the funnel is 157 ms at scale.
- trigram indexes for `ILIKE '%…%'` search: affiliates per workspace are few.
- anything on `referral_clicks`: its existing indexes serve every measured query
  once RLS is set-based.

---

## 5. Changes

| Area | Change | Files |
| --- | --- | --- |
| RLS | Set-based policy helpers; 26 policies rewritten, same authorisation | `src/server/db/migrations/0013_rls_set_membership.sql` |
| Indexes | 3 indexes (DB-2, DB-3, DB-4) | `schema/ledger.ts`, `schema/billing.ts`, `migrations/0014_hot_path_indexes.sql` |
| `withUser` | One `set_config` statement | `src/server/db/index.ts` |
| Request dedup | `cache()` on `getWorkspaceForUser`, `listUserWorkspaces`; new cached `getWorkspaceStanding` | `server/services/workspaces.ts`, `server/services/view-environment.ts` |
| Layouts | Parallel independent reads; `userHasParticipation` instead of loading participations | `(dashboard)/[workspaceSlug]/layout.tsx`, `(affiliate)/layout.tsx`, `repositories/affiliates.ts` |
| Pipelining | Integration health reads and the overview's two aggregates in `Promise.all` after authorisation | `services/integration-health.ts`, `repositories/analytics.ts` |
| i18n payload | Scoped client messages per route group, guarded by a test | `src/i18n/client-namespaces.ts`, `src/i18n/client-messages.ts`, `src/i18n/__tests__/client-namespaces.test.ts`, the root/marketing/auth/docs/dashboard/affiliate layouts, new `onboarding/layout.tsx` |
| Fonts | Preload `latin` only | `src/app/[locale]/layout.tsx` |
| Tooling | Repeatable measurements | `scripts/perf/*`, `pnpm perf:dashboard`, `perf:explain`, `perf:load`, `perf:vitals` |

Not changed on purpose: connection settings (BE-2, BE-3), Supabase Auth calls
(BE-4), the webhook and commission engine, caching of any tenant data (none added),
no Redis, queue, materialized view or CDN.

---

## 6. Before / after

### 6.1 Frontend

| Metric | Before | After | Δ |
| --- | --- | --- | --- |
| Landing HTML (raw / gzip) | 306.7 / 58.2 KB | 189.7 / 25.8 KB | −38% / **−56%** |
| Pricing HTML | 190.8 / 42.8 KB | 74.1 / 10.6 KB | −61% / −75% |
| Login HTML | 159.6 / 40.9 KB | 48.3 / 10.2 KB | −70% / −75% |
| Signup HTML | 154.4 / 39.4 KB | 48.9 / 10.1 KB | −68% / −74% |
| Landing RSC prefetches (decoded / transferred) | 350 / 74 KB | 245 / 46 KB | −30% / −38% |
| Fonts preloaded | 4 files, 262 KB | 2 files, 111 KB | −58% |
| Route JS (every route) | §1.1 | unchanged | 0 — no JS was the problem |
| Lab landing: FCP=LCP / load / transfer | 976 / 2 987 ms / 631 KB | 908 / 2 167 ms / 424 KB | −7% / −27% / −33% |
| Lab landing CLS | 0.0257 | 0.0257 | 0 |
| Lab login: LCP / load / transfer | 900 / 2 883 ms / 661 KB | 852 / 2 167 ms / 459 KB | −5% / −25% / −31% |
| Lab login CLS | 0.0005 | 0.0005 | 0 |

### 6.2 Backend — dashboard navigation (interleaved A/B, same process)

Same process, same pool, before/after alternated every iteration, n=20
(`pnpm perf:dashboard acme 20`). "Before" is `scripts/perf/dashboard-requests-before.ts`,
a statement-for-statement copy of the pre-audit code (slightly optimistic: see its
header). Both variants run against the current RLS policies, so this isolates BE-1;
DB-1's effect only shows at volume (§4).

| Scenario | Before p50 / p95 | After p50 / p95 | Statements | Δ p50 |
| --- | --- | --- | --- | --- |
| `[workspaceSlug]/layout.tsx` reads | 4 507 / 5 076 ms | **2 850** / 5 507 ms | 22 → 17 | **−36.8%** |
| `overview/page.tsx` reads | 5 862 / 6 304 ms | 5 447 / 5 722 ms | 35 → 31 | −7.1% |
| layout + overview (one navigation) | 6 024 / 10 460 ms | **5 519** / 10 592 ms | **57 → 39** | −8.4% |

A second interleaved run with `BENCH_PREPARE=1` gave the same picture (navigation
5 915 → 5 532 ms, −6.5%) — i.e. the pool's `prepare` option has no effect through
Drizzle (see BE-2). The navigation's wall time is now bounded by the overview's
analytics transaction and integration health, which already pipeline; the p95 tail
(~10 s in both variants) is connection/pooler jitter from this laptop, not code.


### 6.3 Load (after; closed loop, `pnpm perf:load`, one `next start` process)

| Target | Concurrency | req/s | p50 | p95 | p99 | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `GET /api/health` | 1 | 6.4 | 146 ms | 155 ms | 1 004 ms | 200 ×97 |
| `GET /api/health` | 10 | 64.1 | 145 ms | 163 ms | 298 ms | 200 ×968 |
| `POST /api/track` unknown key | 1 | 3.4 | 288 ms | 317 ms | 351 ms | 401 ×52 |
| `POST /api/track` unknown key | 20 | 30.6 | 609 ms | 909 ms | 1 065 ms | 401 ×477 |
| `GET /pt-br` | 20 | 647.9 | 30 ms | 37 ms | 42 ms | 200 ×6 494 |

- Throughput of the DB-backed endpoints is bounded by RTT × pool (10); from this
  laptop that is the network, not the CPU.
- A real click (`recordClick`) was **not** load-tested: it writes rows, and there
  is no disposable database.
- `track-reject` at concurrency 20 queues behind the 10-connection pool
  (p50 609 ms against 288 ms serial).

---

## 7. Regression checks

- `pnpm lint` ✓ · `pnpm typecheck` ✓ · `pnpm build` ✓
- `pnpm test`: **417 passed**, 86 skipped (DB-backed).
- `RUN_DB_TESTS=1` DB-backed suites against the dev database, after migrations
  0013 and 0014 were applied (each test rolls back): **83 passed**, 3 skipped,
  0 failed. They cover:
  - tracking and attribution (`ingest.db`)
  - identify (`ingest.db`)
  - Stripe webhook → commissions, refunds, reversals (`billing-events.db`,
    `webhook-events.db`)
  - ledger and portal under RLS (`ledger-portal.db`)
  - plan enforcement and platform billing (`plan-enforcement.db`,
    `platform-billing.db`, `plan-journey.e2e.db`)
  - sandbox (`sandbox.db`)
  - environment analytics (`analytics-environment.db`)
- RLS: row-by-row predicate equivalence (§3 DB-1).
- `src/i18n/__tests__/client-namespaces.test.ts`: every scope ships what its
  client components read.
- Not verified in a browser: authenticated pages. Logging in needs a password,
  which the audit did not enter. The i18n scope test and the DB suites stand in
  for that; a manual click-through of dashboard and portal is still worth doing.

---

## 8. Remaining bottlenecks

1. **BE-3** (connection lifecycle) and **BE-2** (two round trips per parameterised
   statement, intrinsic to Drizzle + postgres.js): the largest remaining latency.
   Both shrink to noise if the app runs in the database's region; BE-3 also needs
   the pool tuned to the deploy target.
2. `listAffiliates` correlated aggregates (DB-5); `listConversions` repeats its
   5-join query for the total; OFFSET pagination on every list.
3. All-time aggregates on the overview (`hold`, `payable`, `getTopAffiliates`)
   scan all of a workspace's commissions; 146–405 ms at 31k.
4. Two Auth round trips per navigation (BE-4).
5. The Stripe webhook's ~20 statements per payment — fine unless replay volume grows.

---

## 9. Signals that would justify bigger changes (not before)

| Signal | Then consider |
| --- | --- |
| `referral_clicks` > ~50M rows, or its indexes stop fitting in memory, or retention deletes become slow | Monthly range partitioning on `occurred_at` (DATABASE.md §5 already anticipates it); drop old partitions instead of deleting |
| Sustained `/api/track` > ~200 req/s per instance, or p95 > 250 ms in-region | Batch click inserts (short in-process buffer) or a queue in front of `recordClick`; keep attribution inside the lock |
| Dashboard analytics > ~500 ms in-region with RLS set-based | Daily rollup tables per program/participation, refreshed incrementally — not a materialized view of the whole ledger |
| More than one app instance under abuse | Move the rate-limit bucket to a shared store (the interface is already storage-agnostic) |
| A workspace with > 5k affiliates or > 500k commissions | Rewrite `listAffiliates` with pre-aggregated CTEs; keyset (cursor) pagination on commissions/conversions using `(workspace_id, created_at, id)` |
| Deep OFFSET pages (> page 50) being used | Keyset pagination |
| Multi-tenant analytics joins dominating CPU | A separate analytics store — last resort |

---

## 10. How to re-measure

```bash
pnpm build && pnpm start -p 3100            # production server
pnpm perf:vitals http://localhost:3100/pt-br 7
pnpm perf:load http://localhost:3100 health 10 15
pnpm perf:load http://localhost:3100 track-reject 20 15
pnpm perf:navigation acme 10                # one dashboard navigation through the app's own db module
pnpm perf:explain                           # plans at synthetic volume, rolled back
RLS_MIGRATION=0013_rls_set_membership pnpm perf:explain   # predicate equivalence on a DB without 0013
```

`perf:explain` and `perf:navigation` are for development databases only.
(`perf:dashboard` and its pre-audit copy were removed in §12: they injected a
postgres.js pool, which the app no longer uses.)

---

## 11. Status

```
FRONTEND_PERFORMANCE_STATUS=GOOD
BACKEND_PERFORMANCE_STATUS=NEEDS_WORK
DATABASE_PERFORMANCE_STATUS=GOOD
SCALABILITY_RISK=MEDIUM
```

- **Frontend GOOD**: lab mobile LCP < 1 s under 4× CPU and slow network, CLS
  ≤ 0.026. First-load JS 213–237 KB gzip is moderate, and no page ships
  unnecessary client trees.
- **Backend NEEDS_WORK**: statements per navigation are down, but each
  parameterised statement still costs two round trips, and cold connections cost
  seconds (BE-2, BE-3).
- **Database GOOD**, after 0013/0014: every measured query < 410 ms at 300k clicks /
  31k commissions under RLS.
- **Scalability MEDIUM**: connection lifecycle, per-instance rate limiting, and
  `referral_clicks` growth — each has a measured trigger in §9.

---

## 12. Second pass (2026-09-16): "the app feels slow on `next start`"

Same laptop, same Supabase project (`aws-0-us-east-2` pooler). DB RTT had
drifted to **~185 ms** (`select 1`), Supabase Auth to **~320 ms** per call.

### 12.1 Measured anatomy

| Shape | postgres.js (Drizzle) | node-postgres (Drizzle) |
| --- | --- | --- |
| `select 1` (no params) | 187 ms | 182 ms |
| one parameterised query | **380 ms** (2 round trips) | **183 ms** (1) |
| `withUser` + one query | 1 020 ms | 781 ms |

node-postgres sends Parse/Bind/Describe/Execute/Sync in one flight; Drizzle's
postgres.js path waits for Describe first (BE-2).

### 12.2 Changes

| Change | Where | Why |
| --- | --- | --- |
| Driver postgres.js → `pg` (node-postgres) | `src/server/db/index.ts`; `execute()` now returns `{ rows }` at every raw-SQL call site | BE-2: one round trip per statement |
| Pool keeps idle connections 5 min, TCP keep-alive | same | BE-3: a fresh pooler connection costs seconds; 20 s idle dropped it between clicks |
| `getSessionUser()` uses `getClaims()` (local ES256 verification) | `src/server/auth/session.ts` | BE-4: the proxy already ran the revocation-aware `getUser()` on the same request; the page no longer repeats it. `/api` routes (not proxied) use `getVerifiedSessionUser()` |
| Client router keeps dynamic pages 30 s (`staleTimes.dynamic`) | `next.config.ts` | Back/forward to a page seen moments ago re-ran every query. Server Actions still clear it (`revalidatePath`, cookie writes, `router.refresh`) |
| `perf:navigation` bench through the app's own db module | `scripts/perf/bench-navigation.ts` | Driver-agnostic before/after |

Migrations (`src/server/db/migrate.ts`) and `perf:explain` still use postgres.js;
they are not on a request path.

### 12.3 Before / after (`pnpm perf:navigation acme 8`, data only)

| Scenario | Before p50 | After p50 | Δ |
| --- | --- | --- | --- |
| layout (shell) | 3 566 ms | 2 428 ms | −32% |
| overview page | 6 806 ms | 4 359 ms | −36% |
| layout + overview (one navigation) | **6 886 ms** | **4 244 ms** | **−38%** |

Plus one Supabase Auth call (~320 ms here) removed from every navigation.

### 12.4 What remains, honestly

- **Geography is still most of the wait.** ~25 statements × ~185 ms. Run the
  app in the database's region (or move the database next to the users) and the
  same navigation is a few hundred milliseconds; no code change gets close.
- `pg` does not pipeline: `Promise.all` inside one transaction now queues on
  the connection (postgres.js pipelined it). The net is still −38%, but pg 8
  prints a one-time deprecation warning for it and pg 9 will refuse it; those
  call sites (analytics, integration health) must be serialised explicitly
  before upgrading to pg 9.
- **Security, found in passing:** `DATABASE_URL` has no `sslmode`, and neither
  driver enables TLS by default, so the connection to the pooler is very
  likely unencrypted. Fix: download the Supabase CA certificate and connect
  with `sslmode=verify-full` (`ssl: { ca }`). Not changed here: it needs the
  certificate, and TLS adds handshake cost that should be measured with it.
