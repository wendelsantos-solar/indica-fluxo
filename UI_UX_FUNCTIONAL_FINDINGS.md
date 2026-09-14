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
| S3 | `disconnectStripeAction` reads `workspaceSlug` with `String(formData.get(...))`, no Zod (CLAUDE.md rule). | `src/features/integrations/actions.ts` | Open |
| S4 | `setParticipationStatusAction` uses `.parse` without try/catch → 500 on bad input. Currently unused by any UI. | `src/features/affiliates/actions.ts` | Open |

## Broken or incomplete core flows

| # | Finding | Evidence | Status |
| --- | --- | --- | --- |
| F1 | The tracking snippet copies a truncated, non-working publishable key. The plaintext keys minted at workspace creation are discarded, so the only way to get a working key is "Rotate", which the page never says. | `D/integrations/page.tsx`, `src/server/services/workspaces.ts` (`createApiKeyPair` result ignored) | UI fixed — no copy button for a non-working snippet; "Gerar nova chave pública" (confirmed) reveals the full key and snippet once. Key issuance at workspace creation still discards the plaintext (open) |
| F2 | Integrations page throws for the `member` role (`listApiKeys` requires admin) and there is no `error.tsx`. | `src/server/services/api-keys.ts` | Partially fixed: `error.tsx` added; the permission gate itself is open |
| F3 | Named referral links render no URL and no copy button, so they cannot be shared; the campaign field is never collected. | `A/links/page.tsx`, `src/features/affiliates/create-link-form.tsx` | Fixed — every named link shows its full URL and a copy button; optional campaign field added |
| F4 | Affiliate status and custom rate cannot be changed from the UI although server actions exist. | `src/features/affiliates/actions.ts` | Open (needs product decision on the affiliate detail view) |
| F5 | No payout batch detail: `listBatchItems` is unused, so after creating a batch nobody can see who is in it. The payable list fetches the affiliate e-mail but never shows it. | `src/server/services/payouts.ts`, `src/features/payouts/payable-list.tsx` | Open |
| F6 | Account menu and palette offer "Affiliate portal" / "Founder dashboard" to people without that role, who are silently bounced back. | `dashboard-shell.tsx`, `affiliate-shell.tsx`, `(affiliate)/layout.tsx` | Fixed — layouts pass the role (existing reads `listParticipationsForUser` / `listUserWorkspaces`); the link is hidden otherwise |
| F7 | **Affiliate Commissions and Conversions were always empty.** `listCommissionsForAffiliate` inner-joined `customers`, which affiliates cannot read under RLS, so every affiliate saw zero rows while their overview showed earnings. Verified as the seeded affiliate: 21 visible commissions, 0 visible customers, 0 joined rows. | `src/server/repositories/commissions.ts` | Fixed — left join; reference falls back to a short customer id. RLS unchanged |
| F8 | `/auth/callback` was not a public path, so confirmation and recovery links sent signed-out users to login before the code exchange — both flows were broken. | `src/proxy.ts` | Fixed |
| F9 | Pending/paused participation: clicks are recorded but not credited. Participation status is now explained in the portal; program status (paused) is not returned by `listParticipationsForUser`, so a paused program is not explained. | `src/server/services/tracking.ts`, `repositories/affiliates.ts` | Partially fixed (participation); program status open |
| F10 | The affiliate's default link points at the IndicaFluxo host (`NEXT_PUBLIC_APP_URL`) while named links point at the program's site; the tracker only runs on the program's site, so the default link may never record a click. | `A/overview`, `A/links` | Open — product decision |

## Data correctness

| # | Finding | Evidence | Status |
| --- | --- | --- | --- |
| D1 | Mixed-currency sums formatted in one currency: overview metrics, commissions summary, affiliates money columns, affiliate overview totals; payouts shows only `payable[0].currency` and hides other currencies. | `src/server/repositories/analytics.ts`, `commissions.ts`; `D/overview`, `D/commissions`, `D/affiliates`, `D/payouts`, `A/overview` | Open |
| D2 | `bigint → ::int` casts on money sums overflow above 2 147 483 647 minor units. | `repositories/programs.ts`, `affiliates.ts`, `commissions.ts` | Open |
| D3 | Program detail metrics are summed from the first 50 affiliates only; tab counts show the full total over a list silently cut at 50. | `D/programs/[programSlug]/page.tsx` | Open |
| D4 | Conversions (founder and affiliate) capped at 100 rows with no pagination; the founder header count shows the capped length. | `D/conversions/page.tsx`, `repositories/commissions.ts` | Open (pagination). Labels fixed: "Últimas 100" instead of a fake total, on both sides |
| D5 | `promoteEligibleCommissions` (an UPDATE) runs during GET renders of Commissions and Payouts, including for read-only members. | `D/commissions/page.tsx`, `D/payouts/page.tsx` | Open |
| D6 | A program saved with recurrence "months = 1" reopens as "first payment only". | `src/features/programs/actions.ts` ↔ program detail mapping | Open |
| D7 | Custom **fixed** affiliate rates are rendered as a percentage in the portal. | `A/overview/page.tsx` | Fixed — fixed custom rates render as money in the portal |
| D8 | Payable selection keeps stale ids after a batch is created ("2 de 1 selecionados"). | `src/features/payouts/payable-list.tsx` | Fixed — nothing pre-selected; selection resets after a batch |
| D9 | Affiliate greeting is bucketed in UTC ("Boa tarde" at 10:00 in São Paulo). | `A/overview/page.tsx` | Fixed — neutral greeting, no time-of-day bucketing |

## Messages and validation

| # | Finding | Evidence | Status |
| --- | --- | --- | --- |
| M1 | Hard-coded English in server actions while matching catalogue keys exist unused: "… was added to the program.", "Batch … created.", "… will join when they sign in.", "Choose a program.", "Use lowercase letters, numbers, - or _.", "Enter a Stripe account id…", "Invalid selection." | `features/{affiliates,payouts,workspaces,integrations}/actions.ts` | Fixed — all listed messages are catalogue keys |
| M2 | `errors.programNotCreated` referenced but missing from both catalogues (renders the key path). | `src/features/programs/actions.ts` | Fixed |
| M3 | Zod's built-in `min`/`max` messages pass through untranslated. | `src/i18n/errors.ts` | Open |
| M4 | Hold-period validation error is never displayed in the program form; invite dialog never renders `programId` errors. | `program-form.tsx`, `invite-affiliate-dialog.tsx` | Fixed — every field error rendered and linked with `aria-describedby` |
| M5 | `status.error` missing: an integration in error state shows the raw word. | `stripe-panel.tsx`, catalogues | Fixed — `status.error` added; error state shows an alert and the reconnect form |
| M6 | Program detail `metadata.title` is the literal "Program". | `D/programs/[programSlug]/page.tsx` | Partially fixed — translated generic title; the program name in the tab title needs a query in `generateMetadata` |

## Behaviour

| # | Finding | Evidence | Status |
| --- | --- | --- | --- |
| B1 | `useActionResult` de-duplicates by message text: a repeated identical success or error is not surfaced. | `src/components/ui/use-action-result.ts` | Fixed — tracked by result identity; `toastOnError` option |
| B2 | React 19 resets uncontrolled `<form action>` forms after the action returns, likely wiping input on validation failure. Not confirmed in a browser. | every mutation form | Mitigated on the forms touched in this phase (values kept in state); other forms not verified |
| B3 | `revalidatePath` calls use locale-less, untranslated paths that probably match no route. | `features/*/actions.ts` | Changed to route patterns for the link action only; the rest still unverified |
| B4 | Destructive actions without confirmation: cancel payout batch, rotate API key, disconnect Stripe. | `batch-actions.tsx`, `api-keys-panel.tsx`, `stripe-panel.tsx` | Fixed — `ConfirmDialog` with plain-language consequence on all three |
| B5 | Program detail tabs are plain anchors → full page reload on every tab change. | `src/components/ui/tabs.tsx` (`TabLink`) | Open |
| B6 | Affiliate links fall back to `https://example.com` when `NEXT_PUBLIC_APP_URL` is missing; integrations falls back to localhost. | `A/links/page.tsx`, `D/integrations/page.tsx` | Open |
| B7 | Password recovery does not exist; Supabase must allow `<APP_URL>/auth/callback` as a redirect URL for the new flow. | Supabase dashboard | Configuration required |
| B8 | In development, next-themes' inline anti-flash script triggers React 19's "Encountered a script tag while rendering React component" console warning. Dev-only; the script still runs on first paint. | `src/components/layout/theme-provider.tsx` (next-themes 0.4.6) | Open — library |
