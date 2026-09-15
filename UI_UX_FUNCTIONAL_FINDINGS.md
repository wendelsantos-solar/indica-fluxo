# Functional findings from the UI/UX audit

Problems found while auditing the interface that are **not** purely visual. The
polish phase does not refactor backend, data or business logic; each item below
is marked with what happened to it.

- **Fixed (UI boundary)** — resolved in this phase because the fix lives in a
  component, a translation, or a thin action boundary.
- **Open** — needs a backend, data or product decision. Not changed.

Paths: `D/` = `src/app/[locale]/(dashboard)/[workspaceSlug]/`,
`A/` = `src/app/[locale]/(affiliate)/affiliate/`.

## Security

| # | Finding | Evidence | Status |
| --- | --- | --- | --- |
| S1 | Open redirect in the auth callback: `next` is concatenated into `${origin}${next}` unvalidated (`next=@evil.com` → `https://host@evil.com`). The failure redirect `?error=auth` is read by nothing. | `src/app/[locale]/(auth)/auth/callback/route.ts` | Fixed — `next` must be a same-origin relative path; failures go to the locale login with a translated notice (tests: `safe-redirect.test.ts`) |
| S2 | Sign-up returns Supabase's raw `error.message`: English text in a pt-br page, and "User already registered" reveals account existence, which sign-in deliberately avoids. | `src/features/auth/actions.ts` | Fixed — provider errors mapped to product messages, technical detail logged without PII (tests: `auth-errors.test.ts`) |
| S3 | `disconnectStripeAction` reads `workspaceSlug` with `String(formData.get(...))`, no Zod (CLAUDE.md rule). | `src/features/integrations/actions.ts` | Fixed — Zod `safeParse`; invalid input returns a translated error |
| S4 | `setParticipationStatusAction` uses `.parse` without try/catch → 500 on bad input. Currently unused by any UI. | `src/features/affiliates/actions.ts` | Fixed — `safeParse` + typed result; services check the participation belongs to the workspace and allowed status transitions (`server/domain/participation.ts`, tested) |

## Broken or incomplete core flows

| # | Finding | Evidence | Status |
| --- | --- | --- | --- |
| F1 | The tracking snippet copies a truncated, non-working publishable key. The plaintext keys minted at workspace creation are discarded, so the only way to get a working key is "Rotate", which the page never says. | `D/integrations/page.tsx`, `src/server/services/workspaces.ts` (`createApiKeyPair` result ignored) | Fixed — workspaces no longer mint unusable keys; Integrations starts with "gere sua chave pública", which reveals the full key and snippet once |
| F2 | Integrations page throws for the `member` role (`listApiKeys` requires admin) and there is no `error.tsx`. | `src/server/services/api-keys.ts` | Fixed — members get a read-only Integrations page; admin-only services are not called |
| F3 | Named referral links render no URL and no copy button, so they cannot be shared; the campaign field is never collected. | `A/links/page.tsx`, `src/features/affiliates/create-link-form.tsx` | Fixed — every named link shows its full URL and a copy button; optional campaign field added |
| F4 | Affiliate status and custom rate cannot be changed from the UI although server actions exist. | `src/features/affiliates/actions.ts` | Fixed — row actions on Affiliates: approve, suspend and reject (confirmed), special rate dialog |
| F5 | No payout batch detail: `listBatchItems` is unused, so after creating a batch nobody can see who is in it. The payable list fetches the affiliate e-mail but never shows it. | `src/server/services/payouts.ts`, `src/features/payouts/payable-list.tsx` | Fixed — batch detail route `/[workspaceSlug]/pagamentos/[batchId]` with items, e-mails and actions; history rows link to it |
| F6 | Account menu and palette offer "Affiliate portal" / "Founder dashboard" to people without that role, who are silently bounced back. | `dashboard-shell.tsx`, `affiliate-shell.tsx`, `(affiliate)/layout.tsx` | Fixed — layouts pass the role (existing reads `listParticipationsForUser` / `listUserWorkspaces`); the link is hidden otherwise |
| F7 | **Affiliate Commissions and Conversions were always empty.** `listCommissionsForAffiliate` inner-joined `customers`, which affiliates cannot read under RLS, so every affiliate saw zero rows while their overview showed earnings. Verified as the seeded affiliate: 21 visible commissions, 0 visible customers, 0 joined rows. | `src/server/repositories/commissions.ts` | Fixed — left join; reference falls back to a short customer id. RLS unchanged |
| F8 | `/auth/callback` was not a public path, so confirmation and recovery links sent signed-out users to login before the code exchange — both flows were broken. | `src/proxy.ts` | Fixed |
| F9 | Pending/paused participation: clicks are recorded but not credited. Participation status is now explained in the portal; program status (paused) is not returned by `listParticipationsForUser`, so a paused program is not explained. | `src/server/services/tracking.ts`, `repositories/affiliates.ts` | Fixed — portal explains draft/paused/archived programs using `programStatus` |
| F10 | The affiliate's default link points at the IndicaFluxo host (`NEXT_PUBLIC_APP_URL`) while named links point at the program's site; the tracker only runs on the program's site, so the default link may never record a click. | `A/overview`, `A/links` | Fixed — `programs.website_url` (migration 0005, applied); default link uses it, notice when missing; seed sets it |

## Data correctness

| # | Finding | Evidence | Status |
| --- | --- | --- | --- |
| D1 | Mixed-currency sums formatted in one currency: overview metrics, commissions summary, affiliates money columns, affiliate overview totals; payouts shows only `payable[0].currency` and hides other currencies. | `src/server/repositories/analytics.ts`, `commissions.ts`; `D/overview`, `D/commissions`, `D/affiliates`, `D/payouts`, `A/overview` | Fixed — totals are per currency everywhere (primary figure + other currencies line, never summed or converted); payouts split by currency so a batch never mixes |
| D2 | `bigint → ::int` casts on money sums overflow above 2 147 483 647 minor units. | `repositories/programs.ts`, `affiliates.ts`, `commissions.ts` | Fixed — money sums are `bigint` mapped to numbers |
| D3 | Program detail metrics are summed from the first 50 affiliates only; tab counts show the full total over a list silently cut at 50. | `D/programs/[programSlug]/page.tsx` | Fixed — `getProgramTotals` aggregates the whole program |
| D4 | Conversions (founder and affiliate) capped at 100 rows with no pagination; the founder header count shows the capped length. | `D/conversions/page.tsx`, `repositories/commissions.ts` | Fixed — founder and portal conversions/commissions paginate with real totals; portal payout history bounded with a note |
| D5 | `promoteEligibleCommissions` (an UPDATE) runs during GET renders of Commissions and Payouts, including for read-only members. | `D/commissions/page.tsx`, `D/payouts/page.tsx` | Fixed — no UPDATE during GET: effective status computed in SQL at read time; promotion runs inside `createPayoutBatch` |
| D6 | A program saved with recurrence "months = 1" reopens as "first payment only". | `src/features/programs/actions.ts` ↔ program detail mapping | Fixed — months recurrence requires 2–120 |
| D7 | Custom **fixed** affiliate rates are rendered as a percentage in the portal. | `A/overview/page.tsx` | Fixed — fixed custom rates render as money in the portal |
| D8 | Payable selection keeps stale ids after a batch is created ("2 de 1 selecionados"). | `src/features/payouts/payable-list.tsx` | Fixed — nothing pre-selected; selection resets after a batch |
| D9 | Affiliate greeting is bucketed in UTC ("Boa tarde" at 10:00 in São Paulo). | `A/overview/page.tsx` | Fixed — neutral greeting, no time-of-day bucketing |

## Messages and validation

| # | Finding | Evidence | Status |
| --- | --- | --- | --- |
| M1 | Hard-coded English in server actions while matching catalogue keys exist unused: "… was added to the program.", "Batch … created.", "… will join when they sign in.", "Choose a program.", "Use lowercase letters, numbers, - or _.", "Enter a Stripe account id…", "Invalid selection." | `features/{affiliates,payouts,workspaces,integrations}/actions.ts` | Fixed — all listed messages are catalogue keys |
| M2 | `errors.programNotCreated` referenced but missing from both catalogues (renders the key path). | `src/features/programs/actions.ts` | Fixed |
| M3 | Zod's built-in `min`/`max` messages pass through untranslated. | `src/i18n/errors.ts` | Fixed — `fieldErrorsFrom` translates Zod built-in issues by code (`zod-issues.ts`, tested) |
| M4 | Hold-period validation error is never displayed in the program form; invite dialog never renders `programId` errors. | `program-form.tsx`, `invite-affiliate-dialog.tsx` | Fixed — every field error rendered and linked with `aria-describedby` |
| M5 | `status.error` missing: an integration in error state shows the raw word. | `stripe-panel.tsx`, catalogues | Fixed — `status.error` added; error state shows an alert and the reconnect form |
| M6 | Program detail `metadata.title` is the literal "Program". | `D/programs/[programSlug]/page.tsx` | Fixed — program name as the tab title, translated fallback |

## Behaviour

| # | Finding | Evidence | Status |
| --- | --- | --- | --- |
| B1 | `useActionResult` de-duplicates by message text: a repeated identical success or error is not surfaced. | `src/components/ui/use-action-result.ts` | Fixed — tracked by result identity; `toastOnError` option |
| B2 | React 19 resets uncontrolled `<form action>` forms after the action returns, likely wiping input on validation failure. Not confirmed in a browser. | every mutation form | Fixed on every mutation form (values kept after a failed submit) |
| B3 | `revalidatePath` calls use locale-less, untranslated paths that probably match no route. | `features/*/actions.ts` | Fixed — actions revalidate the dashboard/portal layout route patterns (`src/lib/revalidate.ts`) |
| B4 | Destructive actions without confirmation: cancel payout batch, rotate API key, disconnect Stripe. | `batch-actions.tsx`, `api-keys-panel.tsx`, `stripe-panel.tsx` | Fixed — `ConfirmDialog` with plain-language consequence on all three |
| B5 | Program detail tabs are plain anchors → full page reload on every tab change. | `src/components/ui/tabs.tsx` (`TabLink`) | Fixed — tabs are client navigations with scroll preserved |
| B6 | Affiliate links fall back to `https://example.com` when `NEXT_PUBLIC_APP_URL` is missing; integrations falls back to localhost. | `A/links/page.tsx`, `D/integrations/page.tsx` | Fixed — default link comes from the program website; named links from their destination |
| B7 | Password recovery does not exist; Supabase must allow `<APP_URL>/auth/callback` as a redirect URL for the new flow. | Supabase dashboard | Documented — README "Supabase Auth configuration" (dashboard settings cannot be applied from code) |
| B8 | In development, next-themes' inline anti-flash script triggers React 19's "Encountered a script tag while rendering React component" console warning. Dev-only; the script still runs on first paint. | `src/components/layout/theme-provider.tsx` (next-themes 0.4.6) | Fixed — script marked non-executable on client renders only |

## Found and fixed while resolving the above

| # | Finding | Evidence | Status |
| --- | --- | --- | --- |
| N1 | A commission could be paid twice: commissions in an unpaid batch (`approved`) were still offered as payable and could enter a second batch. | `services/payouts.ts`, `repositories/commissions.ts` | Fixed — payable excludes commissions held by a non-cancelled batch; re-checked after locking rows |
| N2 | A second payout batch in the same month always failed (unique month reference). | `services/payouts.ts` | Fixed — `September 2026 #2` style suffix |
| N3 | Cancelling an already-cancelled batch could release commissions claimed by a later batch. | `services/payouts.ts` | Fixed — refused |
| N4 | Status and custom-rate changes updated a participation by id without checking it belongs to the acting workspace. | `services/affiliates.ts` | Fixed |
| N5 | Affiliate "revenue generated" was always 0: it joined `transactions`, which affiliates cannot read under RLS. | `repositories/affiliates.ts` | Fixed — sums commission base amounts |
| N6 | Fixed commissions were converted with × 100 for every currency (wrong for JPY and other zero-decimal currencies). | `features/programs/schema.ts`, program detail | Fixed — `majorToMinor` / `minorToMajor` (tested) |
| N7 | Session never carried the person's name; the account menu always showed the e-mail. | `server/auth/session.ts` | Fixed — `full_name` from sign-up metadata |
| N9 | Suspending an affiliate was audited as `affiliate.rejected`. | `services/audit.ts`, `services/affiliates.ts` | Fixed — `affiliate.suspended` |
| N8 | Term tooltips could not be opened on touch screens. | `components/ui/term.tsx` | Fixed — tap toggles, tap outside closes |

## Still open

| # | Finding | Why open |
| --- | --- | --- |
| O1 | Batch references are stored in English ("September 2026") and displayed as stored. | Changing stored references affects existing rows and uniqueness; needs a decision on localisation of ledger data |
| O2 | The payable list is visible to members, though the service refuses them. | Product decision: read-only view vs hidden |
| O4 | The existing dev database's demo program has no `website_url` until the seed is re-run. | Re-running the seed resets demo data; left to you |
