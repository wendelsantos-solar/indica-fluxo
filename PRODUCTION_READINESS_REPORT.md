# PRODUCTION_READINESS_REPORT.md

Rebrand to Refvia, minimum legal pages, and Vercel deploy readiness.
No architecture, provider, engine or SEO-strategy change. Nothing committed.
Date: 2026-09-18.

## BRAND

`BRAND.name = "Refvia"` in `src/lib/brand.ts`, the only place the name is
written; catalogues use `{brand}`. 0 visible old references (source, both
catalogues, rendered HTML on a production-like build). Compatibility ids kept:
`indicafluxo_ref`, `indicafluxo_customer`, `ifx_`, tracker cookies, the
`indica_app` role, preference keys, migrations. Mark kept (no lettering).
Guarded by `release-readiness.test.ts`. → REBRAND_AUDIT.md.

## LEGAL

`/pt-br/termos · /en/terms`, `/pt-br/privacidade · /en/privacy`,
`/pt-br/cookies · /en/cookies`, written only from what the code does (data
inventory from the schema; cookie table from `src/lib/legal/cookies.ts`).
States that Refvia never moves commission money; that Refvia processes program
data on behalf of the SaaS; subprocessors (Supabase, Vercel, Stripe, connected
payment methods); rights; no invented retention periods; Beta integrations
described as in validation. Registered as public + canonical + hreflang (not
keyword-optimised). Linked from the marketing, docs and auth footers and from
sign-up ("Ao criar sua conta, você concorda com os Termos de Uso e reconhece a
Política de Privacidade."). Undecided facts live in `src/lib/legal/config.ts`
(`null` → left out, never a placeholder). **Missing: company name, CNPJ,
address, privacy contact** — the contact block says the channel will be
published before the commercial launch.

## DATABASE

Supabase Postgres via `pg`. Serverless recommendation: **transaction pooler
6543** for Vercel functions — the full DB suite (224 tests) passes on it;
migrations via session pooler from a workstation, never in the build. No
production project exists yet; all migrations must run on it first.

## AUTH

Supabase Auth; every redirect (`emailRedirectTo`, invite `redirectTo`, reset)
is built from `NEXT_PUBLIC_APP_URL`. Needs Site URL + Redirect URLs + e-mail
templates/SMTP set in the production project (checklist). Not smoke-tested on
a real domain yet.

## BILLING

Platform billing (Refvia's Stripe) optional as a set of four env vars; without
them, manual plan request. Founders' Stripe: stable, per-workspace endpoint.
Stripe Connect OAuth: keep disabled until validated. Mercado Pago, AbacatePay,
Asaas: **unchanged Beta** (`beta_implemented`, maturity gate intact).

## WEBHOOKS

All endpoint URLs derive from `NEXT_PUBLIC_APP_URL` via `appUrl()` (the last
direct `process.env … ?? localhost` reads in the tracker route and the
Integrations pages now go through it). `VERCEL_URL` is never used. Node
runtime on every webhook route; verification before parsing; idempotent.

## SECURITY

CSP, `X-Frame-Options: DENY`/`frame-ancestors 'none'`, `nosniff`,
Referrer-Policy, Permissions-Policy unchanged (QA relaxation reverted last
round); **HSTS added** in production. No browser source maps. Secrets audited:
none under `NEXT_PUBLIC_`; `ENCRYPTION_KEY`/`HASH_PEPPER` documented as
generate-once, stable, server-only. Logger redaction unchanged. Error pages
show only a digest. `/api/health` exposes status only.

## SEO

Strategy unchanged. Indexing default **OFF** (`SITE_INDEXING` must be `on`),
and now also forced off on Vercel Preview/Development and on `*.vercel.app`,
localhost and IP hosts (tested). Legal pages added to the sitemap set (visible
only once indexing is on). `/docs/beta` still noindex. The development tunnel
host is no longer hardcoded in `next.config.ts`.

## VERCEL

Native Next.js integration, no `vercel.json`. `engines.node >=24` (Vercel 24.x);
pnpm 11 needs `ENABLE_EXPERIMENTAL_COREPACK=1`. No background workers, no disk
writes, no Edge-only code. → VERCEL_DEPLOY_AUDIT.md, VERCEL_ENVIRONMENT_VARIABLES.md,
VERCEL_DEPLOY_CHECKLIST.md.

## DOMAIN

`https://refvia.com.br` for site and app; apex canonical, `www` → 301 in Vercel
Domains. Configurable through the two public URL variables; `app.` split later
without code changes.

## KNOWN_BLOCKERS (before a public, commercial launch)

1. **Legal identity**: `LEGAL.companyName`, `companyRegistration`, `address`,
   `privacyEmail` (and `BRAND.supportEmail`) are `null`. The pages are safe to
   publish but not complete until these exist; ideally reviewed by a lawyer.
2. **Production Supabase project** + migrations + Auth URL configuration + SMTP.
3. **Domain** `refvia.com.br` DNS/HTTPS on Vercel.
4. **Real-environment smoke tests** (auth e-mails, Stripe test webhook) — cannot
   be run before 2–3.

## KNOWN_WARNINGS

- `_acq` (first-touch measurement, no identifiers) is set without a banner;
  skipped on GPC/DNT. If targeting EU/UK visitors, prior consent may be
  required — owner decision.
- Provider `fetch` calls have no explicit timeout (bounded by the function limit).
- Unknown public URLs redirect to sign-in (307) rather than 404 for signed-out
  visitors (private workspace slugs share the path space).
- Preview deployments without a stable `NEXT_PUBLIC_APP_URL` fall back to
  `localhost` for e-mail/webhook links.
- Supabase Auth e-mail templates (sender name "Refvia") are configured in the
  Supabase dashboard, outside this repository.
- Historical audit documents still say "IndicaFluxo" (records, not product).

## TESTS / BUILD

`pnpm lint` ✓ · `pnpm typecheck` ✓ · `RUN_DB_TESTS=1 vitest run` **743 passed**,
3 skipped (was 731; +12: brand, domain, legal routes/links/placeholders, cookie
inventory, preview/host indexing gate ×3, branded arrays) · DB suite also green
on the transaction pooler · `pnpm build` ✓ (default env and production-like
env with optional providers empty).
