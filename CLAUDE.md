# CLAUDE.md

Operating rules for any AI agent (or human) working in this repository.

## Read before you write

| Before you touch… | Read |
| --- | --- |
| Any UI, component, page, token, colour | `DESIGN.md` |
| Any module, boundary, service, adapter | `ARCHITECTURE.md` |
| Any table, column, index, migration, RLS policy | `DATABASE.md` |
| Plans, billing, limits, entitlements, pricing | `docs/PLANS.md` |

## The ten rules

1. **Read `DESIGN.md` before altering or creating any interface.**
2. **Read `ARCHITECTURE.md` before creating modules.**
3. **Read `DATABASE.md` before altering the schema.**
4. **Never bypass RLS.** RLS is bypassed only by the Drizzle service
   connection (`DATABASE_URL`) inside the webhook/tracking ingest paths and the
   seed, and by `src/lib/supabase/admin.ts` (called from the seed and from
   `src/server/services/invite-mail.ts` for Auth invitation e-mails). Both must
   document why. Neither may reach the browser bundle. See **Supabase security**
   below.
5. **No business logic in React components or Route Handlers.**
   Route Handler = parse → validate (Zod) → authorize → call service → respond.
6. **Never import `stripe` outside `src/lib/billing/stripe/` and
   `src/lib/platform-billing/stripe/`.** The first reads the founders' Stripe;
   the commission engine must only ever see a `NormalizedBillingEvent`. The
   second is Refvia's own billing; services only see
   `PlatformBillingEvent` / `PlatformBillingGateway`. The two never share a
   client or a key (docs/PLANS.md §5).
7. **Never store money in a float.** Integer minor units only
   (`amount_minor`), plus an explicit ISO-4217 `currency`.
8. **Webhooks must be idempotent.** Every provider event is claimed in
   `webhook_events` (`UNIQUE (provider, provider_event_id)`) before work happens.
9. **The financial ledger is append-mostly.** Never delete or silently mutate a
   commission. Refunds create a *reversal* row and flip status to `reversed`.
10. **Do not introduce abstractions without a real, present need.**
    No empty folders, no repository wrappers around trivial CRUD.

## Supabase security

This project uses Supabase's current API-key model, never the legacy
`anon` / `service_role` JWTs.

- `sb_publishable_*` (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) may be used in the
  browser.
- `sb_secret_*` (`SUPABASE_SECRET_KEY`) is server-only.
- **No secret key may use the `NEXT_PUBLIC_` prefix.** `NEXT_PUBLIC_*` is inlined
  into the client bundle. There is no `NEXT_PUBLIC_SUPABASE_SECRET_KEY`, ever.
- Never reintroduce `NEXT_PUBLIC_SUPABASE_ANON_KEY` or
  `SUPABASE_SERVICE_ROLE_KEY`.
- Normal operations respect RLS. `src/lib/supabase/server.ts` uses the
  publishable key plus the user's cookies — being on the server is not a reason
  to use the secret key.
- The Admin Client (`src/lib/supabase/admin.ts`) is for explicit administrative
  operations only. If the operation belongs to the signed-in user, fix the RLS
  policy. Never bypass RLS for convenience.
- `DATABASE_URL` is a different mechanism: direct Postgres for Drizzle,
  migrations and controlled scripts. It is not a Supabase API key.

| Caller | Key | Boundary |
| --- | --- | --- |
| Browser | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | RLS |
| Server, user session | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` + cookies | RLS |
| Server, administrative | `SUPABASE_SECRET_KEY` | bypasses RLS — justify in a comment |
| Drizzle | `DATABASE_URL` | `withUser()` / `withAnon()`, else bypasses RLS |

## Additional standing rules

- **Before changing plans, billing, limits or pricing, read `docs/PLANS.md`.**
  Never branch on a plan code (`if (plan === "growth")`) outside
  `src/lib/plans.ts` / `src/server/domain/entitlements.ts`; services call
  `src/server/services/entitlements.ts`. UI gating is a convenience; the server
  check is the rule.
- The app connects as `indica_app` (migration 0009). A new table needs its own
  `GRANT … TO indica_app`; never grant product tables to `authenticated` or
  `anon` — that re-opens the Supabase Data API.

- `server-only` at the top of every module that reads secrets or the DB.
- All external input is parsed with Zod at the boundary. No `as any` casts to
  make a payload fit.
- Never log secret keys, access tokens, `Authorization` headers, raw webhook
  payloads containing PII, or full e-mail addresses. Use `src/lib/logger.ts`.
- Money formatting always goes through `src/lib/money.ts`.
- Seed/demo data lives only in `src/server/db/seed/` and must never be imported
  by production code paths.
- **No user-facing string is written in a component.** Every one comes from
  `src/i18n/messages/<locale>.json`, and both catalogues change together.
- **Never import `Link`, `redirect`, `usePathname` or `useRouter` from `next/*`
  inside a localised route.** Use `@/i18n/navigation`, or the locale prefix is
  dropped and the link 404s. See ARCHITECTURE.md §6b.
- **Never write the product name.** Code reads `BRAND.name`
  (`src/lib/brand.ts`); catalogues write `{brand}`. The domain comes from
  `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_APP_URL` via `src/lib/site.ts`.
- **A page is indexable only if it is in `src/lib/seo/pages.ts`** and builds its
  metadata with `pageMetadata()`. Everything else inherits the root `noindex`.
  Copy on public pages states only what the code does (SEO_STRATEGY.md §8).
- **No `text-[13px]`, no `rounded-[8px]`.** The type scale and the radius
  vocabulary in `src/design/theme.css` are the whole set. See DESIGN.md §3, §5.

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
pnpm seo:check     # indexability check against a running server (BASE_URL)
pnpm seo:funnel    # acquisition → activation → paid, by first touch
```

A change is not done until `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass.

## Definition of done (per feature)

types · validation · authorization · database · RLS · error handling · loading ·
empty state · success feedback · responsive · dark · light · critical tests.
