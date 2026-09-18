# Refvia

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
| `STRIPE_SECRET_KEY`, `STRIPE_CONNECT_CLIENT_ID` | **server only** | optional; Stripe API calls and Connect OAuth |
| `STRIPE_WEBHOOK_SECRET` | **server only** | optional; only the legacy platform endpoint `/api/webhooks/stripe` (Connect, `stripe listen` in development) |
| `PLATFORM_STRIPE_SECRET_KEY`, `PLATFORM_STRIPE_WEBHOOK_SECRET` | **server only** | optional as a set with the two below; Refvia's own Stripe account, charging workspaces (see **Platform billing**) |
| `STRIPE_LAUNCH_PRICE_ID`, `STRIPE_GROWTH_PRICE_ID` | **server only** | the Prices behind Launch and Growth |

Validation lives in `src/lib/env/client.ts` (browser-safe) and
`src/lib/env/server.ts` (`server-only`). A server secret is never exported by a
module the browser can import.

## Stripe webhooks

Each workspace receives Stripe events on its own endpoint,
`<APP_URL>/api/webhooks/stripe/<integrationId>`. A founder sets it up under
**Integrações**: enter the Stripe account id, add the URL shown there as an
endpoint in their Stripe dashboard (selecting the listed events), then paste
that endpoint's signing secret (`whsec_…`). The secret is stored AES-256-GCM
encrypted with `ENCRYPTION_KEY` and never shown again; the endpoint verifies
every delivery with it and credits the integration's workspace. Integrations
only reports the connection as working once an event has actually arrived.

`/api/webhooks/stripe` (no id) is the legacy platform endpoint, verified with
`STRIPE_WEBHOOK_SECRET` and routed by `event.account`. Keep it for Stripe
Connect and for local development:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# copy the printed whsec_… into STRIPE_WEBHOOK_SECRET
```

To test a workspace endpoint locally instead, forward to
`localhost:3000/api/webhooks/stripe/<integrationId>` and paste the `whsec_…`
that `stripe listen` prints into that workspace's Integrations page.

## Platform billing

Refvia charges workspaces for Launch and Growth through **its own** Stripe
account — not a founder's (docs/PLANS.md §5). Without all four variables below,
Checkout is unavailable and Settings falls back to the manual plan request.

1. **Products and prices.** In Refvia's Stripe account create two products,
   *Launch* and *Growth*, each with one recurring **monthly BRL** Price equal to
   `PLAN_OFFERS` in `src/lib/plans.ts` (R$ 99 and R$ 197). Put the Price ids in
   `STRIPE_LAUNCH_PRICE_ID` and `STRIPE_GROWTH_PRICE_ID`. A subscription on any
   other price is rejected by the webhook (the event is marked `failed` with
   the price id), never guessed.
2. **API key.** The account's secret key goes in `PLATFORM_STRIPE_SECRET_KEY`
   (a restricted key needs write access to Checkout Sessions, Customer portal
   sessions, and read access to Subscriptions).
3. **Webhook endpoint.** Add `<APP_URL>/api/platform-billing/stripe/webhook`
   with these events, and put its signing secret in `PLATFORM_STRIPE_WEBHOOK_SECRET`:
   - `checkout.session.completed`
   - `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
   - `invoice.paid`, `invoice.payment_failed`
4. **Billing Portal** (Settings → Billing → Customer portal): enable invoice
   history and payment-method updates; enable **subscription updates** with the
   Launch and Growth prices as the products customers may switch between
   (quantity not editable); enable **cancellation at the end of the billing
   period**, not immediately. Settings opens the portal for card, invoices and
   cancellation, and opens its "confirm plan change" flow for Launch ↔ Growth.

Checkout runs in subscription mode with no trial, and puts the workspace id in
`client_reference_id` and in the subscription's metadata. The redirect back
is not trusted: only the webhook writes `workspace_subscriptions`, idempotently
(`webhook_events` scope `platform_billing`; a failed event is processed again
when Stripe retries).

Local development:

```bash
stripe listen --forward-to localhost:3000/api/platform-billing/stripe/webhook \
  --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed
# copy the printed whsec_… into PLATFORM_STRIPE_WEBHOOK_SECRET
```

## Connecting a founder's Stripe account

Two supported ways, and the manual one is unchanged and still the default.

**Manual.** The founder enters `acct_…`, creates an endpoint in their own Stripe
dashboard, selects the listed events and pastes the `whsec_…` (see *Stripe
webhooks* above). Needs nothing from Refvia's Stripe account.

**OAuth (Connect).** With `STRIPE_CONNECT_CLIENT_ID` set, Integrations shows
*Conectar com a Stripe*: the founder authorises Refvia on their own account
with `scope=read_only`, and Stripe then delivers that account's events to the
platform **Connect** endpoint `/api/webhooks/stripe`, which routes by
`event.account`. No endpoint to create, no events to select, no secret to copy
(`INTEGRATION_ARCHITECTURE_V2.md` §6).

To enable it in a Stripe account:

1. Enable Connect, then switch on OAuth under **Connect → Onboarding options → OAuth**.
2. Register `<APP_URL>/api/integrations/stripe/oauth/callback` as a redirect URI.
3. Put the `ca_…` client id in `STRIPE_CONNECT_CLIENT_ID` (test and live have
   separate ids).
4. Add a webhook endpoint with **Connected accounts** as its scope (`connect: true`)
   pointing at `<APP_URL>/api/webhooks/stripe`, and put its signing secret in
   `STRIPE_WEBHOOK_SECRET`.

`read_only` is deliberate: Refvia reads events and never charges,
transfers or pays out on a founder's account. Without `STRIPE_CONNECT_CLIENT_ID`
the button is not rendered and nothing changes.

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

## Supabase Auth configuration

Sign-up confirmation and password recovery e-mails land on
`/<locale>/auth/callback`, which exchanges the PKCE code for a session and then
redirects to a validated local path. Supabase only honours redirect targets it
has been told about, so every environment needs this in the Supabase dashboard
(**Authentication → URL Configuration**):

| Setting | Value |
| --- | --- |
| Site URL | the same value as `NEXT_PUBLIC_APP_URL` |
| Redirect URLs | `<APP_URL>/pt-br/auth/callback` and `<APP_URL>/en/auth/callback` (or `<APP_URL>/**`) — add localhost and every deployed origin |

And under **Authentication → Emails**:

- *Confirm signup* and *Reset password* templates must link to
  `{{ .ConfirmationURL }}`, so the `?code=` reaches the callback. Write them in
  Portuguese and English and sign them as Refvia.
- The links only work in the browser that requested them (PKCE). A link opened
  elsewhere shows the "link expired" notice on the login page.
- The resend button on "Confira seu e-mail" waits 60 seconds, matching
  Supabase's default e-mail rate limit. If you change that limit, change
  `COOLDOWN_SECONDS` in `src/features/auth/check-email.tsx`.
- If *Secure password change* is enabled, `updateUser` may require a recent
  sign-in; the reset page then shows the expired-link state.

### Invitations

Inviting an affiliate or a teammate sends Supabase's *Invite user* e-mail
(`auth.admin.inviteUserByEmail`, the Admin Client call site documented in
`src/server/services/invite-mail.ts`) and always shows a copyable link as well.
For the e-mail link to work:

- The *Invite user* template must link to
  `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=invite`. The default
  `{{ .ConfirmationURL }}` puts the session in the URL fragment, which the server
  callback cannot read.
- `<APP_URL>/**` must be in the Redirect URLs.
- Without `SUPABASE_SECRET_KEY` no e-mail is sent; the invitation is still
  created and the founder is told to send the link.

The invited person sets a password on `/<locale>/redefinir-senha?invite=…` and
lands in the portal (affiliate) or the workspace (teammate). Someone who
already has an account signs in with the same e-mail; pending invitations for
that address are claimed at sign-in.

## Mudar o plano de um workspace

O caminho normal é self-service: **Configurações → Plano e cobrança → Launch ou
Growth → Stripe Checkout**, e trocas/cancelamento pelo Stripe Billing Portal. O
webhook de cobrança da plataforma grava `workspace_subscriptions` (ver
"Platform billing" e `docs/PLANS.md`).

Sem as variáveis de cobrança da plataforma (ambiente de desenvolvimento, ou
antes de configurar o Stripe), o Checkout não aparece: um dono ou admin pede o
plano, o que grava `plan_upgrade_requests` e a linha de log
`plan upgrade requested` (configure um alerta sobre ela). O operador libera por
acordo manual, pela conexão de serviço (`DATABASE_URL`) — o app (`indica_app`)
só lê assinaturas.

Pedidos em aberto:

```sql
select w.slug, r.requested_plan, r.created_at
from plan_upgrade_requests r
join workspaces w on w.id = r.workspace_id
where r.handled_at is null
order by r.created_at;
```

Liberar um plano por acordo manual e fechar o pedido, na mesma transação:

```sql
begin;
insert into workspace_subscriptions (workspace_id, plan, status, provider, current_period_start)
select id, 'growth', 'active', 'manual', now() from workspaces where slug = 'acme'
on conflict (workspace_id) do update
  set plan = excluded.plan, status = 'active', provider = 'manual', updated_at = now();
update plan_upgrade_requests set handled_at = now()
where workspace_id = (select id from workspaces where slug = 'acme')
  and handled_at is null;
commit;
```

Encerrar um acordo manual: `update workspace_subscriptions set status =
'cancelled', cancelled_at = now() where workspace_id = …` — o workspace volta
ao Sandbox. Nada é apagado: o que passou do limite continua visível, só não dá
para criar mais até o uso caber no plano (`docs/PLANS.md` §6).

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
