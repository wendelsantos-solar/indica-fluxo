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
| `STRIPE_SECRET_KEY`, `STRIPE_CONNECT_CLIENT_ID` | **server only** | optional; Stripe API calls and Connect OAuth |
| `STRIPE_WEBHOOK_SECRET` | **server only** | optional; only the legacy platform endpoint `/api/webhooks/stripe` (Connect, `stripe listen` in development) |

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
  Portuguese and English and sign them as IndicaFluxo.
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

Não há checkout nem cobrança automática. Todo workspace começa no Starter; um
dono ou admin pede o Growth em **Configurações → Plano**, o que grava uma linha
em `plan_upgrade_requests`. Depois de combinar o pagamento, o operador muda o
plano pela conexão de serviço (`DATABASE_URL`) — o papel `authenticated` não tem
permissão de escrita na coluna `plan` nem em `handled_at` (ver `DATABASE.md` §8).

Cada pedido novo gera a linha de log `plan upgrade requested` (com
`workspaceId`, `from`, `to`). Configure um alerta sobre ela: a página de preços
promete que a equipe entra em contato, e não existe caixa de entrada no app.

Pedidos em aberto:

```sql
select w.slug, r.requested_plan, r.created_at
from plan_upgrade_requests r
join workspaces w on w.id = r.workspace_id
where r.handled_at is null
order by r.created_at;
```

Liberar o plano e fechar o pedido, na mesma transação:

```sql
begin;
update workspaces set plan = 'growth', updated_at = now() where slug = 'acme';
update plan_upgrade_requests set handled_at = now()
where workspace_id = (select id from workspaces where slug = 'acme')
  and handled_at is null;
commit;
```

Voltar para o Starter é o mesmo `update` com `'starter'`. Nada é apagado: o que
já passou do limite continua existindo, só não dá para criar mais até o uso
voltar a caber no plano.

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
