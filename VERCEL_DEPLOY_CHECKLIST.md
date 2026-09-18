# VERCEL_DEPLOY_CHECKLIST.md

First production deploy of Refvia on Vercel, site + app on
`https://refvia.com.br`. Simple, reproducible, reversible. Details behind each
item: VERCEL_DEPLOY_AUDIT.md, VERCEL_ENVIRONMENT_VARIABLES.md,
SEO_DEPLOY_CHECKLIST.md.

## BEFORE DEPLOY

- [ ] `pnpm lint && pnpm typecheck && pnpm test` green
- [ ] `RUN_DB_TESTS=1 pnpm exec vitest run` green against a non-production DB
- [ ] `pnpm build` green (also with production-like public env, see audit)
- [ ] Migrations reviewed: list `src/server/db/migrations/*.sql` not yet applied to production (production is new → all of them)
- [ ] Legal pages read by the owner; **`src/lib/legal/config.ts` filled** (razão social, CNPJ, address, `privacyEmail`) and `BRAND.supportEmail` set once a monitored mailbox exists
- [ ] Brand Refvia everywhere (`release-readiness.test.ts` green)
- [ ] Secrets generated **once** and stored outside Vercel too: `ENCRYPTION_KEY`, `HASH_PEPPER` (`openssl rand -base64 32` each)
- [ ] Production Supabase project created (region chosen consciously)
- [ ] Backup/restore understood (Supabase plan backups / PITR) before real data

## VERCEL PROJECT

- [ ] Import the Git repository; Framework preset **Next.js**; Root Directory = repository root
- [ ] Install/Build/Output: **defaults** (no override, no `vercel.json`)
- [ ] Node.js version: 24.x (from `engines`)
- [ ] Env var `ENABLE_EXPERIMENTAL_COREPACK=1` (All environments) → pnpm 11.11.0
- [ ] Production branch = `main`
- [ ] Deployment Protection on Previews (Vercel Authentication) — previews are not public
- [ ] Never put secrets in the repository

## ENV VARS

- [ ] Production: every row of VERCEL_ENVIRONMENT_VARIABLES.md marked required
- [ ] `NEXT_PUBLIC_APP_URL=https://refvia.com.br`, `NEXT_PUBLIC_SITE_URL=https://refvia.com.br`
- [ ] `SITE_INDEXING` **unset** in all environments for now
- [ ] `STRIPE_CONNECT_CLIENT_ID` **empty** in Production (OAuth not validated yet)
- [ ] Preview: non-production Supabase/DB, test Stripe keys, own `ENCRYPTION_KEY`/`HASH_PEPPER`, stable `NEXT_PUBLIC_APP_URL` if previews need auth
- [ ] No secret in any `NEXT_PUBLIC_*` variable

## DATABASE

- [ ] From a workstation, with the production **session pooler (5432)** URL:
      `DATABASE_URL=<prod session url> pnpm db:migrate` — never in the Vercel build
- [ ] Confirm role `indica_app` exists and RLS policies are applied (migrations 0009+)
- [ ] Do **not** run `pnpm db:seed` against production
- [ ] Set the runtime `DATABASE_URL` in Vercel to the **transaction pooler (6543)**

## SUPABASE

- [ ] Auth → URL Configuration → **Site URL** = `https://refvia.com.br`
- [ ] **Redirect URLs**: `https://refvia.com.br/pt-br/auth/callback`, `https://refvia.com.br/en/auth/callback` (or `https://refvia.com.br/**`); preview URLs only if previews need auth
- [ ] E-mail templates reviewed: sender name/subject say **Refvia** (templates live in Supabase, not in this repo)
- [ ] SMTP: custom SMTP configured for production volume (Supabase's default sender is rate-limited)
- [ ] API keys: publishable + secret of the **production** project

## STRIPE

- [ ] Refvia's own billing (platform): products/prices in live mode; endpoint `https://refvia.com.br/api/platform-billing/stripe/webhook` → `PLATFORM_STRIPE_WEBHOOK_SECRET`; Billing Portal enabled
- [ ] Founders' Stripe: nothing to configure globally — each workspace creates its endpoint `https://refvia.com.br/api/webhooks/stripe/<integrationId>` (shown in Integrations)
- [ ] Legacy endpoint `/api/webhooks/stripe` + `STRIPE_WEBHOOK_SECRET` only if Connect is enabled
- [ ] **Stripe Connect OAuth: keep disabled** (`STRIPE_CONNECT_CLIENT_ID` empty) until the real round trip passes (PROVIDER_PRODUCTION_VALIDATION.md §6); its redirect will be `https://refvia.com.br/api/integrations/stripe/oauth/callback`
- [ ] Never point any webhook at a `*.vercel.app` URL

## DOMAIN

- [ ] Add `refvia.com.br` and `www.refvia.com.br` in Vercel → Domains
- [ ] DNS at the registrar (records Vercel shows); wait for the certificate
- [ ] `www.refvia.com.br` → **redirect 308/301 to `refvia.com.br`** (never serve both)
- [ ] HTTPS works on both; HSTS header present on the apex

## DEPLOY

- [ ] Deploy `main` to Production
- [ ] Watch the build log: Node 24, pnpm 11, `next build` only (no migration)

## POST DEPLOY

Smoke test on `https://refvia.com.br` (then delete QA data):
- [ ] Home, Pricing, Docs, Docs Beta, Terms, Privacy, Cookies (pt-br + en), a 404
- [ ] Sign up (real inbox) → confirmation e-mail → callback → onboarding
- [ ] Log out, log in, reset password (e-mail → callback → new password)
- [ ] Create workspace → program → affiliate → simulated conversion (Sandbox)
- [ ] Integrations: tracker snippet and identify sample show `https://refvia.com.br`
- [ ] Stripe **test mode** workspace connection: valid webhook → event received; resend the same event → duplicate, no second commission; commission created for a referred customer
- [ ] `GET /api/health` → `{"status":"ok"}`
- [ ] Response headers: CSP, `X-Frame-Options: DENY`, HSTS, `nosniff`
- [ ] Logs show no key, token, secret or e-mail
- [ ] Remove QA users/workspaces

## SEO

- [ ] While anything above is open: `SITE_INDEXING` unset → every page `noindex`, robots `Disallow: /`
- [ ] After domain + HTTPS + canonical + www redirect + legal pages: build locally with prod env and run `BASE_URL=https://refvia.com.br pnpm seo:check`
- [ ] Then set `SITE_INDEXING=on` (Production only) and redeploy
- [ ] Google Search Console: Domain property `refvia.com.br` (DNS TXT), submit `https://refvia.com.br/sitemap.xml` (outside the code)

## ROLLBACK

- [ ] App: Vercel → Deployments → previous production deployment → **Instant Rollback**
- [ ] Database: migrations are forward-only; each has rollback notes in its header. Restore from backup/PITR only for data loss
- [ ] Never rotate `ENCRYPTION_KEY`/`HASH_PEPPER` as part of a rollback
- [ ] If a webhook misbehaves: providers retry; fix forward, idempotency prevents doubles
