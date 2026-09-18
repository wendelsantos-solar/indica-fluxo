# VERCEL_DEPLOY_AUDIT.md

Readiness of the codebase for Vercel, checked against the official docs
current on 2026-09-18 (vercel.com/docs: Node.js versions, package managers,
system environment variables; supabase.com/docs: connecting to Postgres).

## Summary

Deployable on Vercel's native Next.js integration with **no `vercel.json`**.
Changes made for it: Node engine declared, HSTS in production, indexing gate
hardened for previews, no hardcoded dev host, URL fallbacks routed through one
helper. Nothing in the app assumes a resident process or a writable disk.

| Area | Finding | Status / action |
| --- | --- | --- |
| **Next.js** | 16.3.5, App Router, `next build` | native Vercel framework preset |
| **Node** | local 26; Vercel offers 24.x (default), 22.x, 20.x (20 deprecated 2026-10-01) | `engines.node: ">=24.0.0"` → Vercel deploys latest **24.x** (docs table: ranges resolve to 24) |
| **Package manager** | pnpm 11.11.0 (`packageManager`), `pnpm-lock.yaml` `lockfileVersion: 9.0`, `pnpm-workspace.yaml` uses pnpm 11's `allowBuilds` | Vercel auto-detects pnpm **9/10** for lockfile 9.0; pnpm 11 is used only through **Corepack**. Set the Vercel env var `ENABLE_EXPERIMENTAL_COREPACK=1` so `packageManager` is honoured (and `allowBuilds` applies). Do not switch package manager |
| **Install / build** | Vercel defaults: `pnpm install`, `pnpm build` (`next build`) | keep defaults. **Build never migrates** — `db:migrate` is a separate, manual step |
| **Output** | `.next` (framework default); 65 static pages + dynamic routes | default |
| **Runtime** | every route handler that touches crypto/DB declares `runtime = "nodejs"` (identify, track, webhooks ×3, platform billing, Stripe OAuth ×2, payout export); pages default to Node | no Edge runtime needed or used. The `proxy.ts` (middleware) only reads cookies/headers and calls Supabase over HTTP |
| **Server Actions** | used across forms; `staleTimes.dynamic = 30` | supported |
| **Streaming / loading** | route `loading.tsx` skeletons | supported |
| **Images** | no `next/image` remote config; OG images via `ImageResponse` | supported |
| **Redirects** | locale redirects in `proxy.ts` (next-intl); **www ↔ apex** not in code | configure in Vercel Domains (redirect `www.refvia.com.br` → `refvia.com.br`, 301/308) |
| **Headers / CSP** | CSP `default-src 'self'`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`; `'unsafe-eval'` dev only; QA framing relaxation of the last round was reverted (byte-identical backup check) | **added** `Strict-Transport-Security: max-age=63072000` in production (no `includeSubDomains`/`preload` yet) |
| **Source maps** | `productionBrowserSourceMaps` not set (Next default: off) | not exposed publicly |
| **Filesystem** | no `fs` writes in app code; seed/scripts are local tools | OK |
| **Background work** | none: no `setInterval`/workers/queues server-side; `AutoRefresh` is client-side `router.refresh()` | **NONE** — no cron needed |
| **Webhooks** | Stripe per-integration, Stripe legacy/Connect, platform billing, generic beta route; verification before parsing; idempotent claims | work on Node functions. URLs derive from `NEXT_PUBLIC_APP_URL` (`appUrl()`), **never `VERCEL_URL`** |
| **Timeouts** | webhook handlers: a few DB statements; Mercado Pago does one provider `fetch` per notification; connecting a provider does 1–2 provider calls; payout CSV export is bounded per batch. Provider `fetch` calls have **no explicit timeout** | within the default function duration; a hung provider call would run until the platform limit — KNOWN_WARNING, no change now |
| **Health** | `GET /api/health` → `{status, database}` with one `select 1`; `X-Robots-Tag: noindex`; no versions, env or secrets | kept (used by `perf:load`); cheap |
| **Error pages** | `[locale]/not-found.tsx`; `error.tsx` in dashboard and affiliate portal show only the opaque `digest` | no stack traces in production |
| **Logging** | `src/lib/logger.ts` redacts tokens/keys (`sk_`, `whsec_`, `APP_USR-`, `$aact_`, `abc_*`, `x-signature`, authorization…); webhook payloads never logged | OK |
| **Assets** | `src/app/icon.svg`, `favicon.ico`, generated OG images — all in Git | OK |
| **Unknown public URLs** | a signed-out visit to an unknown path redirects to sign-in (307) instead of 404: `/{workspaceSlug}` is private and indistinguishable from a typo | documented behaviour, unchanged |

## Database (Supabase + Vercel)

- Driver: `pg` Pool (`max` 10 in production, idle 5 min, keepAlive), one pool
  per function instance (`globalThis.__dbPool`).
- Supabase recommends the **transaction pooler (port 6543)** for serverless
  functions ("These environments open many short-lived connections"), with
  prepared statements off. This code is compatible: `withUser()` sets its
  claims/role with `set_config(..., true)` (transaction-local), advisory locks
  are `pg_advisory_xact_lock`, and node-postgres sends **unnamed** statements.
  Verified: the whole DB test suite (**224 tests, 17 files**) passes against
  the 6543 endpoint of the development project.
- **Recommendation:** Production and Preview `DATABASE_URL` = transaction
  pooler (6543). Migrations run from a workstation with the **session pooler
  (5432)** or direct URL, never from the Vercel build. TLS is the Supabase
  pooler default. Consider lowering `max` if Supabase reports pool pressure.
- Roles: the app relies on `indica_app` (migration 0009) and RLS; a new
  production project must run **all** migrations before the first deploy.

## Environments

| Vercel env | Database | Indexing | Stripe | Notes |
| --- | --- | --- | --- | --- |
| Development (`vercel dev`) | dev project | off | test | local `.env.local` |
| **Preview** | **not production** — dev or a staging project | always off (`VERCEL_ENV=preview` forces noindex) | test keys only | never register provider webhooks to a preview URL; Supabase redirect URLs only if previews need auth |
| **Production** | production project | off until the domain checklist passes (`SITE_INDEXING=on` then) | live when ready | `NEXT_PUBLIC_APP_URL = NEXT_PUBLIC_SITE_URL = https://refvia.com.br` |

Today only a development Supabase project exists (the one in `.env.local`);
a **production project must be created** — see VERCEL_DEPLOY_CHECKLIST.md.

## Domain

One host for site + app: `https://refvia.com.br` (fewer DNS, cookies, auth
redirects and webhook URLs). `siteUrl()`/`appUrl()` stay separate, so a later
`app.refvia.com.br` is an environment change (plus Supabase redirect URLs and
provider webhook URLs). Canonical: apex; `www` → 301 to apex in Vercel.

## Why no `vercel.json`

Framework preset, install/build commands, output and runtimes are all correct
by default; headers live in `next.config.ts`; the pnpm version is solved by
Corepack (an env var), not by an install override. Nothing requires it.
