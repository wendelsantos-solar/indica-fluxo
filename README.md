# indica-fluxo

Affiliate and referral tracking for SaaS. Next.js App Router, Supabase Postgres
with row-level security, Drizzle ORM, Stripe billing.

## Getting started

```bash
pnpm install
cp .env.example .env.local   # fill in real values; never commit them
pnpm db:migrate
pnpm db:seed                 # optional demo workspace
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment

Every variable is documented in `.env.example`. The split matters:

| Variable | Scope | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | public | inlined into the browser bundle |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | `sb_publishable_*` |
| `NEXT_PUBLIC_APP_URL` | public | |
| `SUPABASE_SECRET_KEY` | **server only** | `sb_secret_*`, bypasses RLS |
| `DATABASE_URL` | **server only** | direct Postgres for Drizzle |
| `ENCRYPTION_KEY`, `HASH_PEPPER` | **server only** | |
| `STRIPE_*` | **server only** | |

Validation lives in `src/lib/env/client.ts` (browser-safe) and
`src/lib/env/server.ts` (`server-only`). A server secret is never exported by a
module the browser can import.

## Supabase security

This project uses Supabase's current API-key model, not the legacy
`anon` / `service_role` JWTs.

- `sb_publishable_*` may be used in the browser.
- `sb_secret_*` is server-only.
- **No secret key may use the `NEXT_PUBLIC_` prefix** — `NEXT_PUBLIC_*` values are
  inlined into the client bundle at build time.
- Normal operations respect RLS. Running on the server is not a reason to use
  the secret key.
- The Admin Client is for explicit administrative operations only.
- Never bypass RLS for convenience — fix the policy instead.

Three clients, three responsibilities:

| Module | Key | Result |
| --- | --- | --- |
| `src/lib/supabase/browser.ts` | publishable | RLS as the signed-in user |
| `src/lib/supabase/server.ts` | publishable + cookies | RLS as the signed-in user |
| `src/lib/supabase/admin.ts` | secret (`server-only`) | bypasses RLS — justify every call site (today: the seed only) |

`DATABASE_URL` is a different mechanism: direct Postgres for Drizzle,
migrations and controlled scripts. It is not a Supabase API key.

If a `sb_secret_*` value is ever assigned to a `NEXT_PUBLIC_*` variable, rotate
it in the Supabase dashboard — a build may already have inlined it.

## Commands

```bash
pnpm dev           # dev server
pnpm build         # production build
pnpm lint          # eslint
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest
pnpm db:generate   # generate a drizzle migration from schema changes
pnpm db:migrate    # apply migrations (includes handwritten RLS migrations)
pnpm db:seed       # demo workspace + affiliates + ledger
```

## Further reading

- `ARCHITECTURE.md` — module boundaries, RLS posture, security
- `DATABASE.md` — schema, policies, migrations
- `DESIGN.md` — design tokens and UI conventions
- `CLAUDE.md` — operating rules for contributors and agents
