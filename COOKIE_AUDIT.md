# COOKIE_AUDIT.md

Every cookie and browser-storage key the product sets, from the code. The same
list feeds the public Cookie Policy (`src/lib/legal/cookies.ts` →
`/pt-br/cookies`, `/en/cookies`); a test fails if a cookie constant in code is
missing from it. Date: 2026-09-18.

## On Refvia's own domain

| COOKIE | PURPOSE | FIRST/THIRD PARTY | DURATION | ESSENTIAL? | CODE LOCATION |
| --- | --- | --- | --- | --- | --- |
| `sb-<project>-auth-token` (may be chunked `.0`, `.1`) | Supabase Auth session | first party (set by our server via `@supabase/ssr`) | up to 400 days (`@supabase/ssr` default), cleared on sign-out | **Necessary** | `src/lib/supabase/middleware.ts` (`updateSession`, called by `src/proxy.ts`), `src/lib/supabase/server.ts` |
| `NEXT_LOCALE` | remembers the chosen language | first | 1 year | Functional | `src/i18n/routing.ts` (`localeCookie`) |
| `indica_last_workspace` | reopens the last workspace | first | 1 year | Functional | `src/lib/last-workspace.ts` |
| `ifx_stripe_oauth` | signed CSRF state for the Stripe Connect authorisation | first, httpOnly | 10 minutes | **Necessary** (only during that flow) | `src/app/api/integrations/stripe/oauth/route.ts` |
| `_acq` | first-touch acquisition: channel, landing path, referring host, UTM — no identifier, no personal data | first, httpOnly | 90 days; deleted once the first workspace is created and the origin copied to `workspaces.acquisition` (`src/features/workspaces/actions.ts`) | **Not essential — measurement** | `src/proxy.ts` (`rememberFirstTouch`), `src/lib/seo/acquisition.ts` |
| `indica-theme` (localStorage) | light/dark preference | first | until cleared | Functional | `src/components/layout/theme-provider.tsx` |
| `indica.sidebar.collapsed` (localStorage) | sidebar state | first | until cleared | Functional | `src/components/layout/app-shell.tsx` |

No third-party cookies, no advertising or analytics scripts, no pixels.

## On customers' sites (set by the tracker `/t.js`, on the customer's domain)

| COOKIE | PURPOSE | FIRST/THIRD PARTY | DURATION | ESSENTIAL? | CODE LOCATION |
| --- | --- | --- | --- | --- | --- |
| `_referral_id` | random visitor id, to link the referral to the sign-up | first party **of the customer's domain** | 365 days | Necessary for the affiliate program the customer runs | `src/lib/tracking/script.ts`, `constants.ts` |
| `_referral_ref` | random attribution reference (`ifx_…`) carried to checkout | first party of the customer's domain | 365 days | same | `script.ts`, `attribution-token.ts` |

These are set on the founder's behalf: the founder (controller) informs their
visitors and obtains consent where their jurisdiction requires it. The Cookie
Policy and the Terms say so.

## Consent decision

- Refvia's own site sets **one** non-essential cookie, `_acq`. It carries no
  identifier and no personal data, is first-party and httpOnly.
- Implemented now (no banner, no CMP): `_acq` is **not set** when the browser
  sends `Sec-GPC: 1` (Global Privacy Control) or `DNT: 1`
  (`optedOutOfMeasurement`, `src/lib/seo/acquisition.ts`). Documented in the
  Cookie Policy.
- A consent banner was **not** added: everything else is necessary or
  functional, and `_acq` is aggregate first-touch measurement without
  identifiers. **Owner decision pending** (KNOWN_WARNINGS): if EU/UK visitors
  are targeted, ePrivacy rules may require prior consent even for this cookie;
  the switch is a single gate in `rememberFirstTouch`.
- Auth cookies and the tracker are never blocked by this.
