# Polish checklist — by route

How each box was checked:

- **seen** — opened in a browser (1440/1280/1024/768/390/375 as noted), dark and light
- **crawl** — fetched in both locales as signed-out, founder and affiliate; HTTP status checked, page scanned for raw i18n keys and error screens (54 URLs, all 200, zero raw keys)
- **code** — reviewed in source; not exercised in a browser

Authenticated routes were seen through a temporary development-only impersonation
of the two seed accounts (queries still ran under RLS as those users). It was
removed before commit.

`[x]` done · `[~]` done with a known limit (see note) · `[ ]` not done

---

## Public

### `/` landing — P0

- [x] desktop 1440 dark — seen, full scroll
- [x] tablet 1024 / 768 — seen; nav collapses below 1024 (it wrapped at 768 before)
- [x] mobile 390 light — seen; no horizontal overflow (`scrollWidth` = viewport)
- [x] mobile menu — opens, lists Produto / Como funciona / Preços / Documentação / Entrar, Escape closes
- [x] dark / light — both seen
- [x] CTA — one amber action per viewport; mock buttons inside visuals are secondary
- [x] copy — rewritten pt-br + en; no invented customers, logos or numbers; only Stripe shown as an integration
- [x] narrative — hero → flow → problem → how it works → product → two sides → integrations → principles → pricing → closing
- [x] SEO — title, description, canonical, `hreflang` (pt-BR, en-US, x-default), OpenGraph, Twitter card, generated OG image (fetched, 200 image/png), single H1
- [x] performance — Server Components; the only client leaf is the navbar (scroll state + menu)
- [x] accessibility — product visuals `aria-hidden`, no focusable elements inside them; headings in order

### `/precos` · `/pricing`

- [x] desktop dark — seen
- [x] shares the new navbar/footer
- [x] Starter shows "Grátis" instead of "R$ 0,00"
- [x] canonical + `hreflang`
- [x] prices come from one shared module with the landing preview

### `/documentacao` · `/docs`

- [x] crawl both locales
- [x] canonical + `hreflang`
- [~] content unchanged in this phase (grade B)

### `/entrar` · `/login` — P0

- [x] desktop split layout dark — seen
- [x] show/hide password, Caps Lock hint — code
- [x] "Esqueci minha senha" link — seen
- [x] human error copy ("E-mail ou senha incorretos."), no provider text — code + tests (`auth-errors.test.ts`)
- [x] `?next=` honoured and validated — code + tests (`safe-redirect.test.ts`)
- [x] `?error=link` notice — code
- [~] loading / invalid / network states — code only (no real sign-in submitted)

### `/criar-conta` · `/signup` — P0

- [x] seen desktop dark
- [x] name / e-mail / password only; live "8+ caracteres" requirement
- [x] "Grátis para começar. Sem cartão de crédito." (true: no card collection exists)
- [x] check-your-e-mail state with resend (60 s cooldown) and "Usar outro e-mail" — code
- [x] Supabase errors mapped to product messages — code + tests

### `/esqueci-a-senha` · `/forgot-password` — P0 (new)

- [x] seen desktop dark
- [x] same confirmation whether or not the account exists — code

### `/redefinir-senha` · `/reset-password` — P0 (new)

- [x] crawl both locales
- [x] expired-link state without a session; form + success with one — code
- [~] needs Supabase redirect URL allow-list configuration (see functional findings B7)

### `/primeiros-passos` · `/onboarding` — P0

- [x] seen desktop dark — stepper, name-only form, "Preferências" disclosure with locale defaults
- [x] "Voltar ao painel" for someone who already has a workspace
- [x] step 2 `programas/novo?onboarding=1` — seen; reduced form, "Configurações avançadas" disclosure, "Fazer depois"
- [~] step 3 activation checklist on the overview — code + 6 unit tests (`activation.test.ts`); not seen rendered, because it only appears for a workspace with no activity and none exists in the seed (creating one would have meant submitting a form against the shared database)

### 404

- [x] `[locale]/not-found` — seen (unknown path)
- [x] in-shell not-found for a missing program — seen

---

## Founder dashboard

| Route | Desktop dark | Mobile 390 | Light | Crawl pt/en | Loading | Error | Empty | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Visão geral | [x] | [x] | [x] | [x] | [x] | [x] | [~] | headline metric spanned into its neighbour at 390 — fixed; activation branch see onboarding |
| Programas | [x] | [ ] | [ ] | [x] | [x] | [x] | [x] code | focus ring on row link |
| Programa (detalhe) | [x] | [ ] | [ ] | [x] | [x] detail skeleton | [x] | [x] code | name no longer repeated; capped lists say so |
| Novo programa | [x] | [ ] | [ ] | [x] | [x] | [x] | — | progressive disclosure |
| Afiliados | [x] | [x] | [x] | [x] | [x] | [x] | [x] code | "Convidar afiliado" everywhere; no-program empty state has an action |
| Conversões | [x] | [ ] | [ ] | [x] | [x] | [x] | [x] code | "Últimas 100" instead of a fake total |
| Comissões | [x] | [ ] | [ ] | [x] | [x] | [x] | [x] code | jargon removed; Term definitions |
| Pagamentos | [x] | [ ] | [ ] | [x] | [x] | [x] | [x] code | nothing pre-selected; cancel batch confirmed |
| Integrações | [x] | [ ] | [ ] | [x] | [x] | [x] | [x] code | honest key/snippet state; confirmations |
| Configurações | [x] | [ ] | [ ] | [x] | [x] | [x] | — | translated currency/timezone names |

Shell: sidebar, rail, drawer focus trap, ⌘/Ctrl hint, palette, account menu role-aware links — [x] code, sidebar/palette seen in the previous phase.

## Affiliate portal

| Route | Desktop dark | Mobile 375 | Light | Crawl pt/en | Loading | Error | Empty | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Visão geral | [ ] | [x] | [x] | [x] | [x] | [x] | [x] code | "A receber" first, one amber copy action |
| Links | [x] | [ ] | [ ] | [x] | [x] | [x] | [x] code | named links now show URL + copy |
| Conversões | [x] | [ ] | [ ] | [x] | [x] | [x] | [x] | **was always empty (F7) — fixed and seen with data** |
| Comissões | [x] | [ ] | [ ] | [x] | [x] | [x] | [x] | same fix; status definitions |
| Pagamentos | [ ] | [ ] | [ ] | [x] | [x] | [x] | [x] code | |
| Configurações | [ ] | [ ] | [ ] | [x] | [x] | [x] | — | copy no longer promises payout details |

---

## Cross-cutting

- [x] one inline alert (`InlineAlert`), one confirmation (`ConfirmDialog`), one pagination, one code-and-copy field per surface
- [x] destructive actions confirmed: cancel payout batch, generate new API key, disconnect Stripe
- [x] hard-coded English removed from server actions (M1)
- [x] brand is IndicaFluxo in every catalogue string and the logo
- [x] both catalogues in parity (test) and no raw keys on any crawled page
- [x] toasts bottom-centre on phones; loading buttons keep their width
- [x] select chevron and danger-button text are theme tokens (no hard-coded hex/white)
- [~] tooltips (`Term`) do not open on tap on touch devices; Commissions has a disclosure fallback, other terms do not
- [ ] dev console: next-themes' inline script triggers React 19's "Encountered a script tag" warning in development — library behaviour, not fixed
