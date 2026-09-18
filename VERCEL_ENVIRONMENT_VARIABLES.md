# VERCEL_ENVIRONMENT_VARIABLES.md

Every variable the code reads (`src/lib/env/*`, `src/lib/site.ts`,
`src/lib/seo/metadata.ts`, `billing-connections.ts`), per Vercel environment.
**Never commit values.** `.env.example` holds the same list with comments.
`NEXT_PUBLIC_*` values are inlined into the browser bundle and are therefore
public by design; none of them is a secret (audited: the client schema rejects
an `sb_secret_*` key in a `NEXT_PUBLIC_` variable).

| Variable | Scope | Production | Preview | Required | Notes |
| --- | --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | public | prod project URL | dev/staging project URL | yes | |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | `sb_publishable_…` (prod) | dev/staging | yes | never a `sb_secret_` |
| `SUPABASE_SECRET_KEY` | **server** | `sb_secret_…` (prod) | dev/staging | yes (invites, seed) | bypasses RLS — admin client only |
| `DATABASE_URL` | **server** | prod **transaction pooler :6543** | dev/staging :6543 | yes | migrations use the session URL from a workstation |
| `ENCRYPTION_KEY` | **server** | `openssl rand -base64 32`, **generated once, never rotated casually** | its own value | yes | AES-256-GCM for provider credentials and webhook secrets; a new value makes stored ones unreadable (reconnect needed). Keep a secure copy outside Vercel |
| `HASH_PEPPER` | **server** | `openssl rand -base64 32`, **stable** | its own value | yes | changing it invalidates API keys and e-mail hashes |
| `NEXT_PUBLIC_APP_URL` | public | `https://refvia.com.br` | a **stable** preview host (e.g. a `staging` branch domain) — unset falls back to `http://localhost:3000`, which breaks sign-up e-mails and webhook URLs on previews | **yes in production** | base of every webhook, OAuth and e-mail redirect URL. Never `VERCEL_URL` |
| `NEXT_PUBLIC_SITE_URL` | public | `https://refvia.com.br` | unset | recommended | canonical, hreflang, sitemap, OG. Empty = app URL |
| `SITE_INDEXING` | server/build | **unset** until the SEO checklist passes, then `on` | never | no | ignored on Preview/Development and on `*.vercel.app`/localhost hosts; read at build → redeploy after changing |
| `STRIPE_SECRET_KEY` | **server** | optional | test | no | legacy/founder Stripe helpers |
| `STRIPE_WEBHOOK_SECRET` | **server** | optional | test | no | legacy platform endpoint `/api/webhooks/stripe` (Connect / `stripe listen`) |
| `STRIPE_CONNECT_CLIENT_ID` | **server** | **leave empty** until the Connect OAuth round trip is validated | test client if testing | no | when set, "Autorizar no Stripe" appears |
| `PLATFORM_STRIPE_SECRET_KEY` | **server** | Refvia's own Stripe `sk_live_…` | `sk_test_…` | set of four, optional | without all four, Settings offers the manual plan request |
| `PLATFORM_STRIPE_WEBHOOK_SECRET` | **server** | `whsec_…` of `/api/platform-billing/stripe/webhook` | test endpoint's | ↑ | |
| `STRIPE_LAUNCH_PRICE_ID` / `STRIPE_GROWTH_PRICE_ID` | **server** | live price ids | test price ids | ↑ | must match `PLAN_OFFERS` |
| `BILLING_CONNECTORS_DISABLED` | server | empty (beta connectors stay Beta) — or e.g. `mercado_pago,asaas` to hide | empty | no | Stripe cannot be disabled |
| `ENABLE_EXPERIMENTAL_COREPACK` | **Vercel build** | `1` | `1` | yes | so Vercel uses `pnpm@11.11.0` from `packageManager` |

Set by Vercel, read by the code: `VERCEL_ENV` (Preview/Development ⇒ never
indexed). `NODE_ENV` is set by Next.js. `RUN_DB_TESTS` is test-only.

**Not used, on purpose:** `VERCEL_URL`, `VERCEL_BRANCH_URL` (a preview URL must
never become a webhook or canonical URL). No other variable exists in code.
