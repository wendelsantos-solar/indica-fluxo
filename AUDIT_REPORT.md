# AUDIT_REPORT.md

Duplication and implementation-conflict audit, run after two agent sessions
worked the same branch concurrently.

Scope: every file under `src/`, both migrations, all five documents,
`package.json`, `next.config.ts`, and the git history.
Method: exported-symbol collision map (460 exports), semantic grouping by
responsibility, statement-level migration inventory, RLS policy matrix,
dependency import census, dead-export reachability scan.

No database was reachable during the audit (`DATABASE_URL` was an empty
placeholder), so §Data duplication is diagnostic SQL only — nothing was run
against real data, and nothing was deleted.

---

# Executive Summary

**The two sessions did not produce competing implementations.** This is the
headline, and it is unusual. The expected failure mode — two commission
engines, two Supabase client sets, two tracking modules, a `v2` folder — did
not happen:

| Check | Result |
| --- | --- |
| Exported symbols colliding across files | **1**, and it is intentional (`createClient` in `supabase/browser.ts` + `supabase/server.ts`, the Supabase convention) |
| Files named `old` / `new` / `copy` / `backup` / `v2` / `temp` | **0** |
| Duplicate `CREATE TABLE` / `CREATE TYPE` / `CREATE POLICY` statements | **0** |
| Stripe SDK import sites outside `lib/billing/stripe/` | **0** |
| Webhook handlers / signature verifiers / dedupe tables | **1 each** |
| Competing import aliases (`@/lib/...` vs `@/utils/...`) | **0** — single `@/*` alias, no `../..` escapes |
| Parallel theme systems / hardcoded colours | **0** |
| Routes serving the same responsibility | **0** |

What the concurrent work *did* leave behind is a different class of problem:
**13 dependencies nobody imports, documentation that describes code that does
not exist, RLS policies broader than the product needs, and a feature wired
from the service layer down but never connected to a screen.**

Counts:

| Category | Count |
| --- | --- |
| P0 findings | 1 |
| P1 findings | 4 |
| P2 findings | 3 |
| P3 findings | 6 |
| P4 findings | 2 |
| Exact duplicates | 0 |
| Semantic duplicates | 4 |
| Alternative implementations | 0 |
| Dead exports (after filtering framework/type noise) | 23 |
| Migration conflicts | 0 |
| RLS policies that are genuinely duplicated | 0 (10 overlap by design) |

---

# P0 Findings

## P0-1 — `affiliates_self_update` lets an affiliate rewrite any column of their own row

**Severity:** Critical · **CWE-639** (Authorization Bypass Through User-Controlled Key),
**CWE-863** (Incorrect Authorization) · **OWASP API3:2023** Broken Object Property
Level Authorization · **CVSS v3.1 estimate: 8.1**
(`AV:N/AC:L/PR:L/UI:N/S:C/C:L/I:H/A:N`)

**Evidence** — `src/server/db/migrations/0001_rls_and_triggers.sql:360`:

```sql
CREATE POLICY "affiliates_self_update" ON public.affiliates
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
```

combined with the blanket privilege grant at `0001:169`:

```sql
EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated;', t);
```

Postgres RLS has no column scope. `WITH CHECK (user_id = auth.uid())` verifies
only that the row still belongs to the caller *after* the update — it says
nothing about which other columns changed.

**Exploitation scenario** — any signed-in affiliate, using the publishable key
and their own session against PostgREST (no application code involved):

```sql
-- re-activate yourself after being suspended
UPDATE affiliates SET status = 'active' WHERE user_id = auth.uid();

-- relocate your affiliate row into another tenant
UPDATE affiliates SET workspace_id = '<other-workspace-uuid>' WHERE user_id = auth.uid();
```

The second write moves a row across the tenant boundary. It does **not** expose
the other tenant's programs or ledger (those key off `program_affiliates`, which
is unchanged), but it does satisfy `workspaces_affiliate_select`, handing the
attacker read access to a workspace row they were never enrolled in — and it
corrupts `affiliates.workspace_id`, the single column the entire isolation model
is built on (ARCHITECTURE.md §2: *"keeps tenant isolation expressible as a single
column predicate"*).

**Business impact** — a suspended affiliate silently restores themselves; tenant
isolation becomes falsifiable by the user it is meant to constrain. For a
platform whose selling point is being the source of truth for commissions, a
writable tenant key is a credibility problem before it is a technical one.

**Why it is dead surface, not a feature** — `src/app/(affiliate)/affiliate/settings/page.tsx`
is entirely read-only, and no service or server action writes to `affiliates` on
behalf of an affiliate. The only writer is `setParticipationStatus()`
(`services/affiliates.ts:163`), which runs under `requireMembership(..., "admin")`.
Nothing in the product needs this policy.

**Remediation** — drop the policy. Least privilege, and it matches DATABASE.md §6:
*"Affiliates have no INSERT, UPDATE or DELETE on any financial table."*

```sql
-- insecure: column-blind self-update
CREATE POLICY "affiliates_self_update" ON public.affiliates
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- secure: no affiliate write at all; founders still write via affiliates_admin_write
DROP POLICY IF EXISTS "affiliates_self_update" ON public.affiliates;
```

If affiliate self-service profile editing is wanted later, RLS cannot express it
alone (`WITH CHECK` cannot compare `OLD` to `NEW`). It needs a `BEFORE UPDATE`
trigger that restores the protected columns when the actor is not an admin.

---

# P1 Findings

## P1-1 — The ledger grants `DELETE` to every owner/admin, contradicting rule 9

**Severity:** High · **CWE-284** Improper Access Control · **CVSS 6.5**

`0001:169` grants `DELETE` on all 21 tables to `authenticated`, and the §6 loop
creates `commissions_admin_write ... FOR ALL` for owner/admin. So an admin
session can issue `DELETE FROM commissions` through PostgREST and it will
succeed.

CLAUDE.md rule 9 and DATABASE.md §3 both state the ledger is append-mostly and a
commission is *never deleted*. The application honours that; the database does
not enforce it. The guarantee is a convention, not a constraint.

`transactions` has the same exposure. `UPDATE` must stay — `createPayoutBatch`
flips `commissions.status` under `withUser()` — but `DELETE` is never used by any
code path.

**Remediation** — `REVOKE DELETE ON public.commissions, public.transactions FROM authenticated;`

## P1-2 — `workspace_invites` unique index is case-sensitive; the trigger that consumes it is not

**Severity:** High (data integrity) · **CWE-178** Improper Handling of Case Sensitivity

Three layers disagree:

| Layer | Behaviour |
| --- | --- |
| `schema/tenancy.ts:72` | `uniqueIndex(...).on(t.workspaceId, t.email)` — case **sensitive** |
| `migrations/0000:343` | `ON "workspace_invites" ("workspace_id","email")` — case **sensitive** |
| `migrations/0001:40` (`handle_new_user`) | `lower(i.email) = lower(NEW.email)` — case **insensitive** |
| `DATABASE.md:61` | documents `UNIQUE (workspace_id, lower(email))` — case **insensitive** |

`affiliates` gets this right (`0000:347` uses `lower("email")`). `workspace_invites`
does not. Consequence: `Bob@acme.com` and `bob@acme.com` are two accepted pending
invites for one person; the trigger then matches both and marks both accepted,
and the invite list shows a duplicate that can never be cleaned up by e-mail.

Classification: **IMPLEMENTATION_DIVERGED** — the documentation states the correct
intent, the schema is the thing that is wrong.

**Remediation** — recreate the index with `lower(email)` and align the Drizzle
schema. Additive corrective migration; no data loss.

## P1-3 — DATABASE.md claims an RLS regression test that does not exist

**Severity:** High (false assurance) · **CWE-1053** Missing Documentation of Security-Relevant Behaviour

`DATABASE.md:247`:

> Isolation is regression-tested in `src/server/db/__tests__/rls.test.ts`:
> tenant A cannot read tenant B, and affiliate A cannot read affiliate B.

`src/server/db/__tests__/` does not exist. The test suite is five files —
`money`, `commission`, `attribution`, `visitor`, `no-secret-in-public-env` — all
pure unit tests. **Zero** tests exercise RLS, the webhook handler, or idempotency.

This is the most dangerous kind of documentation error: it tells the next
reviewer that the tenant boundary is covered, so they stop looking. P0-1 above is
exactly the class of bug such a test would have caught.

Classification: **DOCUMENTATION_STALE**.

## P1-4 — 154 files, zero commits

**Severity:** High (operational)

`git log` contains one commit: `4445409 Initial commit from Create Next App`
(20 files, the scaffold). Everything both sessions produced — 154 files, ~15,000
lines, both migrations, all four documents — is **untracked**. A stray
`git clean -fd`, a bad `checkout`, or a disk error erases the entire project.

It also means this audit could not use `git diff`/`git show` to attribute work to
either session: there is no history to compare. The symbol-level and
statement-level analysis above replaced it.

**Remediation** — commit now, before any consolidation, so the audit's changes
are reviewable as a diff against a real baseline.

---

# Semantic Duplicates

Four found. None are competing implementations; all are one concept expressed in
more than one place.

## SD-1 — Status enums exist twice: as Postgres enums and as hand-written TS unions

**Classification: SEMANTIC_DUPLICATE** · P2

| Concept | Source A (canonical) | Source B (hand-written) |
| --- | --- | --- |
| program affiliate status | `schema/enums.ts:26` `programAffiliateStatusEnum` | `repositories/affiliates.ts:40`, `:163`; `domain/types.ts:27` |
| commission status | `schema/enums.ts:64` `commissionStatusEnum` | `repositories/commissions.ts:17` `type CommissionStatus` |
| payout item status | `schema/enums.ts:78` `payoutItemStatusEnum` | `repositories/commissions.ts:255` |
| billing provider | `schema/enums.ts:34` `billingProviderEnum` | `lib/billing/types.ts:9` `BillingProviderId` |
| commission type / attribution model | `schema/enums.ts:19`, `:24` | `domain/types.ts:6`, `:7` |
| workspace role | `schema/enums.ts:3` `workspaceRoleEnum` | `policies/workspace.ts:10` `WorkspaceRole` |

Drizzle already exposes the single source: `(typeof commissionStatusEnum.enumValues)[number]`.
Adding a seventh commission status means editing two places today, and the
compiler will not tell you about the second.

**Nuance — do not consolidate all of these.** `domain/types.ts` and
`lib/billing/types.ts` are deliberately free of Drizzle so the commission engine
stays pure and the billing contract stays provider-agnostic (ARCHITECTURE.md §1,
§4). Importing even a type from `schema/` couples them. For those two files this
is a **LEGITIMATE_VARIATION** and the duplication is the price of the boundary —
but it should be a *checked* price: a type-level assertion test that the domain
union and the Postgres enum still agree.

The repository layer has no such excuse: it already imports Drizzle.

## SD-2 — The UTM field list is re-expressed in four shapes

**Classification: SEMANTIC_DUPLICATE** · P3

| Location | Shape |
| --- | --- |
| `lib/tracking/constants.ts:9` | `UTM_PARAMS` tuple — the intended source of truth |
| `lib/tracking/visitor.ts:33` | `extractUtm()`, derived from the tuple — **never called by anything** |
| `app/api/track/route.ts:26-32` | Zod object, five fields written out by hand |
| `server/services/tracking.ts:27` | `Record<"utm_source" | ... >`, written out by hand |
| `lib/tracking/script.ts:74-78` | inline in the browser tracker string |

The tracker copy is unavoidable — it is standalone JavaScript with no imports, by
design. The Zod schema and the service type are not: both could be derived from
`UTM_PARAMS`. Adding `utm_id` today means touching four places and the compiler
catches none of them.

## SD-3 — `TRACKER_PATH` is declared and then ignored in favour of four string literals

**Classification: SEMANTIC_DUPLICATE** · P3

`lib/tracking/constants.ts:7` declares `export const TRACKER_PATH = "/t.js"`. It
has zero references. `/t.js` is instead hardcoded at:

- `src/proxy.ts:12` and `:33`
- `next.config.ts:49`
- `app/(dashboard)/[workspaceSlug]/integrations/page.tsx:31` (the install snippet)
- `app/(marketing)/docs/page.tsx:10` (the documented snippet)

## SD-4 — `isExpired()` and `isAttributionValidAt()` are the same predicate, negated

**Classification: LEGITIMATE_VARIATION** · P4

`domain/attribution.ts:41` and `:113`. Both are used, both are tested, and they
read differently at their call sites (`isExpired(state, now)` inside the resolver,
`isAttributionValidAt(state, at)` inside the engine). Recording it for
completeness; consolidating would make both call sites read worse.

---

# File Duplicates

**None.** No file pair shares a responsibility.

The Supabase layer is the place this normally goes wrong, and it is clean —
exactly the three modules the documentation prescribes, plus the SSR middleware
helper:

| File | Key | Role | Verdict |
| --- | --- | --- | --- |
| `lib/supabase/browser.ts` | publishable | browser client, RLS as user | canonical |
| `lib/supabase/server.ts` | publishable + cookies | server client, RLS as user | canonical |
| `lib/supabase/admin.ts` | secret | bypasses RLS, one call site | canonical |
| `lib/supabase/middleware.ts` | publishable | cookie refresh for the edge proxy | canonical, not a duplicate of `server.ts` |

No `supabase-browser.ts`, no `service-role.ts`, no `utils/supabase/`. The legacy
key names (`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) survive
only inside `lib/env/__tests__/no-secret-in-public-env.test.ts`, which exists
specifically to fail if they come back.

The same holds for the engines: one `domain/commission.ts`, one
`domain/attribution.ts`, one `services/billing-events.ts`, one
`lib/billing/stripe/adapter.ts`, one `services/tracking.ts`.

---

# Database Conflicts

Drizzle schema, migration `0000`, and DATABASE.md were compared table by table.

| Check | Result |
| --- | --- |
| Tables defined twice | none |
| Enums defined twice | none — 18 enums, each created once |
| Overlapping-responsibility tables | none |
| Equivalent columns under different names (`amount` vs `amount_minor`, `customer_external_id` vs `external_customer_id`) | none — naming is consistent throughout |
| Duplicate foreign keys | none |
| Duplicate indexes under different names | none |
| Redundant timestamps | none |
| Orphan/legacy columns | none |

One genuine mismatch: **P1-2** (`workspace_invites` case sensitivity).

Two documentation drifts, no schema impact:

- `DATABASE.md:253` — `ip_hash = sha256(ip + IP_HASH_SALT)`. No such variable
  exists; the implementation (`lib/crypto/hash.ts:18`) uses `HASH_PEPPER`.
- `DATABASE.md:243` — *"The Supabase secret key … has no call sites here."* It
  now has one, `server/db/seed/auth.ts`. README.md and ARCHITECTURE.md already
  say so; DATABASE.md is the straggler.

---

# Migration Conflicts

**None.** Two migrations, a clean sequence, no overlap.

| # | Tag | Intent | Effect | Conflicts |
| --- | --- | --- | --- | --- |
| 0000 | `absurd_bushwacker` | generated baseline | 18 enums, 21 tables, 20 unique + 24 plain indexes, all FKs and CHECKs | none |
| 0001 | `rls_and_triggers` | handwritten: what Drizzle cannot model | `auth.users` FK, `handle_new_user` + `set_updated_at` triggers, 5 `SECURITY DEFINER` helpers, `ENABLE`+`FORCE` RLS on 21 tables, 28 policies, `REVOKE` for `anon` and `webhook_events` | none |

Statement-level inventory: every `CREATE TABLE`, `CREATE TYPE`, `CREATE INDEX`
and `CREATE POLICY` appears exactly once across both files. No `ALTER TABLE`
repeats a column. No structure is created and then recreated.
`meta/_journal.json` lists both entries in order with no gaps.

**Application state: neither migration has been applied to any database.**
`DATABASE_URL` was an empty placeholder throughout. So there is no "already in
production" constraint on corrective work — but the corrections below are still
written as an additive `0002` rather than by editing `0000`, because a teammate
may have applied them to a database this audit cannot see.

---

# RLS Conflicts

28 policies across 21 tables. Matrix (helpers: `M` = `is_workspace_member`,
`R` = `has_workspace_role(owner|admin)`, `O` = `owns_participation`,
`A` = `current_affiliate_ids`):

| Table | Role | Op | Policy | USING | WITH CHECK |
| --- | --- | --- | --- | --- | --- |
| profiles | authenticated | SELECT | `profiles_self_select` | `id = auth.uid()` | — |
| profiles | authenticated | UPDATE | `profiles_self_update` | `id = auth.uid()` | same |
| workspaces | authenticated | SELECT | `workspaces_member_select` | `M(id)` | — |
| workspaces | authenticated | SELECT | `workspaces_affiliate_select` | enrolled affiliate | — |
| workspaces | authenticated | UPDATE | `workspaces_admin_update` | `R(id)` | same |
| workspaces | authenticated | DELETE | `workspaces_owner_delete` | `owner` only | — |
| workspace_members | authenticated | SELECT | `workspace_members_select` | self **or** `M(ws)` | — |
| workspace_members | authenticated | ALL | `workspace_members_admin_write` | `R(ws)` | same |
| workspace_invites | authenticated | ALL | `workspace_invites_admin_all` | `R(ws)` | same |
| programs · affiliates · customers · subscriptions · transactions · integrations · api_keys · payout_batches · audit_logs · commissions | authenticated | SELECT | `<t>_member_select` | `M(workspace_id)` | — |
| *(same 10 tables)* | authenticated | ALL | `<t>_admin_write` | `R(workspace_id)` | same |
| programs | authenticated | SELECT | `programs_affiliate_select` | enrolled via `A()` | — |
| program_affiliates | authenticated | SELECT | `program_affiliates_member_select` | `M(program_workspace)` **or** `A()` | — |
| program_affiliates | authenticated | ALL | `program_affiliates_admin_write` | `R(program_workspace)` | same |
| referral_links | authenticated | SELECT | `referral_links_select` | `O()` **or** member | — |
| referral_links | authenticated | ALL | `referral_links_owner_write` | `O()` **or** `R()` | same |
| referral_clicks | authenticated | SELECT | `referral_clicks_select` | member **or** `O()` | — |
| attributions | authenticated | SELECT | `attributions_select` | member **or** `O()` | — |
| commissions | authenticated | SELECT | `commissions_affiliate_select` | `O()` | — |
| payout_items | authenticated | SELECT | `payout_items_select` | `O()` **or** member | — |
| payout_items | authenticated | ALL | `payout_items_admin_write` | `R(batch.ws)` | same |
| payout_item_commissions | authenticated | SELECT | `payout_item_commissions_select` | `O()` **or** member | — |
| payout_batches | authenticated | SELECT | `payout_batches_affiliate_select` | owns an item | — |
| affiliates | authenticated | SELECT | `affiliates_self_select` | `user_id = auth.uid()` | — |
| **affiliates** | **authenticated** | **UPDATE** | **`affiliates_self_update`** | **`user_id = auth.uid()`** | **same → P0-1** |
| webhook_events | — | — | *(none; `REVOKE ALL`)* | service connection only | — |

**Genuinely duplicated policies: none.** Two structural notes:

1. The 10 `<t>_admin_write` policies are `FOR ALL`, so their `USING` clause also
   satisfies `SELECT`, overlapping `<t>_member_select` for owners/admins.
   Permissive policies OR together, so this changes no outcome — it is the
   standard Postgres idiom, not a conflict. **P4, cosmetic.**
2. Two SELECT policies on `workspaces` and two on `programs` (member path +
   affiliate path) are deliberate: they serve different actors and neither is a
   superset of the other. Not duplicates.

**Permissiveness check** — one policy grants more than intended: `affiliates_self_update`
(P0-1). One privilege grant exceeds every code path: `DELETE` on the ledger (P1-1).
No policy is unreachable/unused.

`anon` holds `USAGE` on the schema and nothing else (`REVOKE ALL ON ALL TABLES
IN SCHEMA public FROM anon`, `0001:404`) — which makes `withAnon()`
(`server/db/index.ts:81`) unable to read anything. See DC-1.

---

# Dead Code

The reachability scan flagged 105 exports with no reference outside their
defining file. Most are noise and are **KEEP**:

- Drizzle `*Relations` exports (12) — consumed by `drizzle(pool, { schema })`
  through `export *`, not by name.
- Type/interface exports that describe a function's own signature (≈55).
- Next.js conventions (`metadata`, `dynamic`, `runtime`, `GET`, `POST`).

After filtering, **23 real dead exports** remain:

| Symbol | File | Classification | Note |
| --- | --- | --- | --- |
| `withAnon` | `server/db/index.ts:81` | **REQUIRES_REVIEW** | DC-1 below |
| `REFERRAL_COOKIE` | `lib/tracking/constants.ts:4` | SAFE_TO_DELETE | `"_referral_ref"` is never read or written |
| `TRACKER_PATH` | `lib/tracking/constants.ts:7` | **KEEP — start using it** | SD-3 |
| `extractUtm` | `lib/tracking/visitor.ts:33` | **KEEP — start using it** | SD-2 |
| `refreshLinkCounters` | `services/tracking.ts:216` | REQUIRES_REVIEW | DC-2 below |
| `setParticipationStatusAction` | `features/affiliates/actions.ts` | **REQUIRES_REVIEW** | P2-1 — no UI |
| `setCustomRateAction` | `features/affiliates/actions.ts` | **REQUIRES_REVIEW** | P2-1 — no UI |
| `ErrorState` | `components/feedback/empty-state.tsx` | REQUIRES_REVIEW | P2-2 |
| `Skeleton` | `components/ui/skeleton.tsx` | REQUIRES_REVIEW | P2-2 |
| `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | `components/ui/tabs.tsx` | KEEP | program detail uses `TabLink` (URL-driven tabs); the Radix set is the client-side alternative, unused so far |
| `Tooltip` | `components/ui/tooltip.tsx` | KEEP | DESIGN.md §9 mandates it; no consumer yet |
| `CardFooter`, `DialogClose` | `components/ui/{card,dialog}.tsx` | KEEP | primitive completeness |
| `encryptSecret`, `decryptSecret` | `lib/crypto/secrets.ts` | KEEP | ARCHITECTURE.md §4 — for providers that force a stored token; Stripe Connect stores only an account id |
| `safeEqual` | `lib/crypto/hash.ts:56` | KEEP | see DC-3 |
| `listCommissionsForParticipations` | `repositories/commissions.ts:186` | SAFE_TO_DELETE | superseded by `listPayableByAffiliate` |
| `findParticipationByCode`, `findParticipationById` | `repositories/affiliates.ts` | REQUIRES_REVIEW | `services/tracking.ts` inlines the same lookup |
| `findProgramById`, `countPrograms`, `slugExists` | `repositories/{programs,workspaces}.ts` | REQUIRES_REVIEW | plausible near-future use |
| `listBatchItems` | `services/payouts.ts:297` | REQUIRES_REVIEW | batch detail view not built |
| `getSessionUser` | `server/auth/session.ts` | KEEP | the nullable counterpart to `requireUser` |
| `isProduction`, `isSupportedProvider`, `minorUnitExponent`, `computeAmount` | various | KEEP | small, tested, obviously-useful predicates |

**DC-1 — `withAnon()` can never succeed.** `server/db/index.ts:81` downgrades the
session to the `anon` role, but `anon` has been revoked from every table. Any
query inside it raises `permission denied`. It has no callers. ARCHITECTURE.md §2
and DATABASE.md §6 both describe it as a live part of the design
(*"everything else runs through `withUser()` / `withAnon()`"*) — **IMPLEMENTATION_DIVERGED**.
Either delete it or grant `anon` the specific reads it was meant for. Do not
leave a function whose contract is "always throws".

**DC-2 — `refreshLinkCounters()` is never called**, so `referral_links.click_count_cached`
stays `0` forever. No UI reads it either, so nothing is visibly wrong today —
but a column documented as a display convenience is permanently stale, which is
worse than not having it. Either call it after ingest or drop the column.

**DC-3 — `safeEqual()` is unused, and correctly so.** `authenticateApiKey()`
(`services/api-keys.ts:119`) looks keys up *by hash* in SQL, so there is no
plaintext comparison to make constant-time. Keeping the helper is fine; it must
not be mistaken for evidence that a timing-safe compare is happening somewhere.

**Dead assets:** `public/file.svg`, `globe.svg`, `next.svg`, `vercel.svg`,
`window.svg` — Create-Next-App scaffold, zero references. **SAFE_TO_DELETE.**

**Not dead:** `AGENTS.md` is regenerated by `next dev` on every run. It is not a
competing rules document and must not be removed.

---

# Dependency Duplication

| Dependency | Responsibility | Actual usage | Duplication | Recommendation |
| --- | --- | --- | --- | --- |
| `react-hook-form` | form state | **0 imports** | forms use React 19 `useActionState` (7 call sites) | **remove** |
| `@hookform/resolvers` | RHF + Zod bridge | **0 imports** | dead with the above | **remove** |
| `date-fns` | date maths | **0 imports** | `lib/utils.ts` `addDays`/`addMonths` | **remove** |
| `@radix-ui/react-avatar` | avatar | **0 imports** | `components/layout/logo.tsx` + `initials()` | **remove** |
| `@radix-ui/react-checkbox` | checkbox | **0 imports** | native `<input type=checkbox>` in payouts | **remove** |
| `@radix-ui/react-label` | label | **0 imports** | `components/ui/field.tsx` | **remove** |
| `@radix-ui/react-popover` | popover | **0 imports** | none | **remove** |
| `@radix-ui/react-scroll-area` | scroll area | **0 imports** | `TableContainer scrollable` | **remove** |
| `@radix-ui/react-select` | select | **0 imports** | native `<select>` in `program-form.tsx` | **remove** |
| `@radix-ui/react-separator` | separator | **0 imports** | `border-t` utilities | **remove** |
| `@radix-ui/react-switch` | switch | **0 imports** | none | **remove** |
| `@types/pg` | types for `pg` | used by `src/server/db/index.ts` | driver switched to `pg` (PERFORMANCE_AUDIT.md §12) | keep |
| `@vitejs/plugin-react` | JSX in Vitest | **0 imports** | `vitest.config.ts` does not register it; no `.tsx` tests | **remove** — re-add with the first component test |
| `vite-tsconfig-paths` | path aliases in Vitest | **0 imports** | `vitest.config.ts` uses built-in `resolve.tsconfigPaths` | **remove** |
| `@radix-ui/react-{dialog,dropdown-menu,slot,tabs,tooltip}` | primitives | **used** | — | keep |
| `clsx` + `tailwind-merge` | class merging | both used inside `cn()` | complementary, not competing | keep |
| `zod` | validation | 10 sites | no `yup` present | keep |
| `lucide-react` | icons | 24 sites | no second icon set | keep |
| `sonner` | toasts | 2 sites | no second toast lib | keep |

No classic duplication pair (`date-fns` + `dayjs` + `moment`, `zod` + `yup`,
`clsx` + `classnames`, two chart libraries) exists. The charts are hand-written
SVG in `components/data-display/area-chart.tsx` — no charting dependency at all.

**14 packages to remove. All are zero-import; every removal is reversible with
`pnpm add`.**

---

# Other Findings

## P2-1 — Affiliate approval is built everywhere except the screen

`setParticipationStatus()` (`services/affiliates.ts:143`) and `setCustomRate()`
are implemented, authorized, audited (`affiliate.approved` / `affiliate.rejected`)
and RLS-covered. `setParticipationStatusAction` and `setCustomRateAction` wrap
them as server actions. **Neither action is referenced by a single `.tsx` file.**

Every other server action is wired to exactly one component. These two are the
only orphans — the clearest fingerprint of the concurrent sessions in the whole
codebase: one built the service path, the other never built the screen.

Product consequence: `program_affiliates.status = 'pending'` is reachable
(`inviteAffiliate` can create it, and the seed does) but there is no in-product
way to approve it. A pending affiliate earns nothing, because
`calculateCommission` skips `participation_not_approved`. The founder has no
button.

## P2-2 — Loading and error states exist as components but not as routes

`src/app` contains **zero** `loading.tsx`, `error.tsx` or `not-found.tsx` files.
`ErrorState` is exported and never used. `Skeleton` is used only by
`overview/page.tsx`, which is also the only route with a `<Suspense>` boundary.

CLAUDE.md's definition of done requires *loading · empty state · error handling*
per feature. Empty states are done well and consistently. The other two are
present on one route out of sixteen. An unhandled throw in any other page — a
dropped database connection, an RLS denial — surfaces as the framework's default
error screen.

## P3 — Documentation drift (classified)

| Document | Statement | Reality | Class |
| --- | --- | --- | --- |
| DATABASE.md:247 | `src/server/db/__tests__/rls.test.ts` regression-tests isolation | file does not exist | **DOCUMENTATION_STALE** (P1-3) |
| DATABASE.md:253 | `ip_hash = sha256(ip + IP_HASH_SALT)` | variable is `HASH_PEPPER` | DOCUMENTATION_STALE |
| DATABASE.md:243 | secret key "has no call sites here" | `seed/auth.ts` is one | DOCUMENTATION_STALE |
| DATABASE.md:61 | invites UNIQUE on `lower(email)` | schema is case-sensitive | **IMPLEMENTATION_DIVERGED** (P1-2) |
| ARCHITECTURE.md:97 | service-role call site `lib/tracking/ingest` | actual path `server/services/tracking.ts` | DOCUMENTATION_STALE |
| ARCHITECTURE.md:195 | `verifyWebhook(raw, signature, secret)` (3 args) | implementation takes 2; secret is read internally | DOCUMENTATION_STALE |
| ARCHITECTURE.md:196 | `normalizeEvent(event: ProviderEvent)` | type is `VerifiedWebhook` | DOCUMENTATION_STALE |
| ARCHITECTURE.md:105 / DATABASE.md:245 | `withAnon()` is part of the live path | unreachable + uncalled | **IMPLEMENTATION_DIVERGED** (DC-1) |

Everything else in all five documents checked out. DESIGN.md is **DOCUMENTATION_CURRENT**
in full: the token architecture, the light/dark split, the radius scale and the
"no hardcoded colour" rule are all honoured with zero violations found.

---

# Data Duplication — diagnostic queries only

No database was reachable, so **nothing was executed and nothing was deleted.**
Run these before creating any new constraint.

```sql
-- 1. workspace_members — protected by UNIQUE (workspace_id, user_id)
select workspace_id, user_id, count(*) from workspace_members
 group by 1,2 having count(*) > 1;

-- 2. program_affiliates — protected by UNIQUE (program_id, affiliate_id) and (program_id, code)
select program_id, affiliate_id, count(*) from program_affiliates
 group by 1,2 having count(*) > 1;

-- 3. webhook_events — the idempotency gate, UNIQUE (provider, provider_event_id)
select provider, provider_event_id, count(*) from webhook_events
 group by 1,2 having count(*) > 1;

-- 4. transactions — UNIQUE (workspace_id, provider, provider_transaction_id)
select workspace_id, provider, provider_transaction_id, count(*) from transactions
 group by 1,2,3 having count(*) > 1;

-- 5. commissions — UNIQUE (transaction_id, program_affiliate_id) WHERE not a reversal
select transaction_id, program_affiliate_id, count(*) from commissions
 where reversal_of_commission_id is null
 group by 1,2 having count(*) > 1;

-- 6. THE ONE WITH NO CONSTRAINT BEHIND IT (P1-2): case-variant pending invites
select workspace_id, lower(email), count(*) from workspace_invites
 where accepted_at is null
 group by 1,2 having count(*) > 1;

-- 7. sanity: a commission whose reversal exceeds it, or an orphaned reversal
select c.id, c.commission_amount_minor,
       sum(r.commission_amount_minor) as reversed
  from commissions c
  join commissions r on r.reversal_of_commission_id = c.id
 group by c.id, c.commission_amount_minor
having abs(sum(r.commission_amount_minor)) > c.commission_amount_minor;
```

Queries 1–5 are each backed by a `UNIQUE` index, so they should return zero rows
by construction; they are here to *prove* the constraints survived. **Query 6 is
the only one with no constraint behind it** — that is P1-2, and it is why the
corrective migration adds the index rather than assuming.

---

# Recommended Canonical Implementations

Applying the §27 criteria (architecture fit, security, tests, simplicity,
correctness, consumers, maturity). In every case a single implementation already
exists and is sound, so "canonical" here means *the path that stays*:

| Responsibility | Canonical | Why |
| --- | --- | --- |
| Supabase browser / server / admin | `lib/supabase/{browser,server,admin}.ts` | matches all three documents; admin is `server-only` with a justified single call site |
| Commission maths | `server/domain/commission.ts` | pure, 30 tests, no I/O |
| Attribution | `server/domain/attribution.ts` | pure, 20 tests |
| Billing normalisation | `lib/billing/stripe/adapter.ts` behind `lib/billing/types.ts` | only Stripe import site in the repo |
| Webhook idempotency | `webhook_events` UNIQUE `(provider, provider_event_id)` + `transactions` UNIQUE | two independent barriers, as documented |
| Click ingest | `server/services/tracking.ts` | single writer; `/api/track` holds no logic |
| Money formatting / maths | `lib/money.ts` | the only implementation |
| Date maths | `lib/utils.ts` (`addDays`, `addMonths`) | `date-fns` is the redundant one — remove it, not these |
| Status vocabulary (persistence + repositories) | `schema/enums.ts` via `enumValues` | already the DB's source of truth |
| Status vocabulary (domain + billing contract) | `domain/types.ts`, `lib/billing/types.ts` | deliberately decoupled — keep separate, add a type-level agreement test |
| Design tokens | `design/tokens.css` → `design/theme.css` → `app/globals.css` | one chain, zero violations |
| Tracker path constant | `lib/tracking/constants.ts` `TRACKER_PATH` | start importing it instead of the four literals |

---

# Safe Deletions

Applied in this pass (all zero-reference, all reversible):

1. `public/{file,globe,next,vercel,window}.svg` — scaffold leftovers.
2. `REFERRAL_COOKIE` in `lib/tracking/constants.ts` — never read or written.
3. `listCommissionsForParticipations` in `repositories/commissions.ts` — superseded.
4. 14 zero-import packages from `package.json` (see Dependency Duplication).

# Manual Review Required

1. **P2-1** — build the affiliate approve / reject / custom-rate UI, or delete
   the two orphan actions. This is a product decision, not a cleanup one.
2. **DC-1 `withAnon`** — delete it, or grant `anon` the reads it was designed for.
3. **DC-2 `refreshLinkCounters`** — call it after ingest, or drop
   `click_count_cached`.
4. **P2-2** — route-level `loading.tsx` / `error.tsx` across sixteen routes.
5. **P1-3** — the RLS regression test. It cannot be written honestly until a
   database is reachable; the documentation claim has been corrected in the
   meantime.
6. **SD-1** — deriving repository-layer status unions from `enumValues`.
   mechanical, but it touches four files and deserves its own diff.

# Consolidation Plan

Ordered by risk, smallest reviewable steps:

| Step | Change | Risk |
| --- | --- | --- |
| 0 | **Commit the 154 untracked files first** (P1-4) so every step below is a reviewable diff | none |
| 1 | Migration `0002`: drop `affiliates_self_update` (**P0-1**), revoke `DELETE` on `commissions`/`transactions` (**P1-1**), recreate `workspace_invites_pending_key` on `lower(email)` (**P1-2**) | low — additive, never applied anywhere yet |
| 2 | Align `schema/tenancy.ts` with the new invite index | none — typecheck-verified |
| 3 | Remove the 14 unused dependencies | low — zero imports |
| 4 | Delete the 5 scaffold SVGs and `REFERRAL_COOKIE`; adopt `TRACKER_PATH` in `proxy.ts` | none |
| 5 | Correct the eight documentation drifts | none |
| 6 | *(separate diff)* derive repository status unions from `enumValues` | medium |
| 7 | *(separate diff)* affiliate approval UI | product decision |
| 8 | *(blocked on a database)* RLS + webhook integration tests | — |

Steps 0–5 are applied in this pass. Steps 6–8 are deliberately left out to keep
this change set reviewable.

---

# Addendum — found while applying the plan

## AD-1 — Drizzle's snapshot only knows migration `0000`

`migrations/meta/` contains `0000_snapshot.json` and `_journal.json` — nothing
for `0001`, and nothing for `0002`. Handwritten migrations are invisible to
drizzle-kit's differ by construction.

Consequence: the next `pnpm db:generate` after any schema edit diffs the schema
against the **0000** snapshot, so it can re-emit statements that `0001` or `0002`
already applied. The `lower(email)` change made in this pass is exactly such a
case — a future `generate` would propose dropping and recreating
`workspace_invites_pending_key` a second time.

This is pre-existing (it was already true of `0001`) and is the normal cost of
mixing generated and handwritten migrations. It is not a conflict today, but it
is a trap for the next person.

**Recommendation — do not fix by hand.** Whoever next runs `pnpm db:generate`
must read the generated SQL before committing it and delete statements that
`0001`/`0002` already own. Worth a line in CLAUDE.md's commands section once a
database exists to verify against.

## Applied in this pass

| Step | Status |
| --- | --- |
| 0 — commit the 154 untracked files | **NOT DONE** — needs the user's go-ahead |
| 1 — migration `0002` (P0-1, P1-1, P1-2) | applied |
| 2 — `schema/tenancy.ts` aligned to `lower(email)` | applied |
| 3 — 14 unused dependencies removed | applied |
| 4 — 5 SVGs, `REFERRAL_COOKIE`, `listCommissionsForParticipations` deleted; `TRACKER_PATH` adopted in `proxy.ts` and the integrations snippet | applied |
| 5 — 8 documentation drifts corrected across DATABASE.md and ARCHITECTURE.md | applied |
| 6 — status unions from `enumValues` | deferred, separate diff |
| 7 — affiliate approval UI | deferred, product decision |
| 8 — RLS + webhook integration tests | blocked on a reachable database |

Validation after the change set: `lint` pass · `typecheck` pass ·
`test` 55/55 pass · `build` pass (33 routes).

**Migration `0002` has not been executed against any database** — no
`DATABASE_URL` was configured. It is reviewed SQL, not applied SQL.
