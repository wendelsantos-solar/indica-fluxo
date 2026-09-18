# MULTI_PROVIDER_VISUAL_QA.md

Real visual QA of the multi-provider screens, in Chrome, signed in as a
workspace owner (`rota-digital`, development database). Date: 2026-09-18.

## How it was run

- **Data**: QA-only rows inserted for the run and deleted afterwards (tagged
  `metadata.qaFixture`): Stripe "Brasil" + Stripe "EUA" (multi-account, OAuth,
  no event yet), Mercado Pago in `pending` with a 60-character account name
  (long-name case), AbacatePay in `error / invalid_credentials` (error case),
  Asaas `connected` with three events and two payments (healthy + diagnostics).
- **Breakpoints**: the Chrome window could not be narrowed (it reported
  `innerWidth` 1800), so every route was loaded in a same-origin `iframe` at
  each width, measuring `scrollWidth` and any element whose box passed the
  viewport, then screenshotted. This needed `frame-ancestors 'self'` in dev for
  the duration of the run; `next.config.ts` was restored (`DENY` / `'none'`) —
  verified before the build.
- **Dark**: the `dark` class on `<html>` inside the frame.
- **Checks per route**: horizontal overflow (automatic, all widths), missing
  i18n keys (text scan), interactive elements without an accessible name,
  status dots without a word, one `h1`; visual pass at 1440 and 375, light and
  dark.

Widths: 1440 · 1280 · 1024 · 768 · 430 · 390 · 375 on the overview; 1440 · 768
· 375 on every other route; docs at 1440 · 1024 · 768 · 375.

## Results

| ROUTE | DESKTOP | TABLET | MOBILE | LIGHT | DARK | ISSUES | FIXES |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Integrações · Visão geral | PASS (1440/1280/1024) | PASS (768) | PASS (430/390/375) | PASS | PASS | 1) setup ticked "Conectar AbacatePay" while its key was refused; 2) Stripe connected-but-silent read as "not connected"; 3) MP pending said "aguardando o primeiro evento" when it waits for the panel step; 4) selection details had no open/closed affordance; 5) "5 conectados" green with nothing healthy; 6) account name truncated to "L…" at 375 | 1) `deriveSetup`: only a working connection ticks, `state: waiting/attention` (+ test); 2–3) hints `connectWaiting`, `connectAttention`, `connectPanel`, dashed/alert icons, link "Ver {provider}"; 4) chevron rotating on `details`; 5) count dot green only when ≥ 1 healthy; 6) account name moved to the second line of the row |
| Integrações · Pagamentos | PASS | PASS | PASS | PASS | PASS | long account name wrapped the Beta badge and status to a second line (uneven card heights); card title did not say which account | card title "Stripe — Brasil", single line with truncation + `title`, badges `shrink-0`; MP pending card says "Falta 1 etapa no painel do Mercado Pago" |
| Integrações · Rastreamento | PASS | PASS | PASS | PASS | — | no status for Customer Identity | new "Rastreamento e identificação" block: Rastreador / Identificação do cliente with evidence ("Funcionando · há 8 minutos") + explanation + link |
| Integrações · API | PASS | PASS | PASS | PASS | — | — | — |
| Adicionar meio de pagamento (dialog) | PASS | — | overflow check PASS | PASS | — | no word for Stripe's maturity; Beta unexplained | "Integração estável · …" on Stripe, Beta badge with `title`, one Beta line under the list |
| Conectar Asaas (dialog form) | PASS | — | — | PASS | — | — | — |
| Provider conectado (Asaas, healthy) | PASS | PASS | PASS | PASS | — | everything open at once; rename/key fields 1000 px wide; "Webhook: Registrado…" in mono | Activity, Capabilities, Advanced folded with chevrons; forms `max-w-xl`; prose values not mono |
| Provider Beta (all three) | PASS | PASS | PASS | PASS | PASS | Beta only a badge | status line + short Beta callout on the detail |
| Provider com erro (AbacatePay) | PASS | PASS | PASS | PASS | — | reconnect key field full width | issue action `max-w-md` |
| Mercado Pago pendente (setup step) | PASS | PASS | PASS | PASS | PASS | "Precisa de atenção: aguardando o primeiro evento — nada está errado" contradicted itself; two adjacent numbered lists; secret field full width | `awaitingFirstEvent` no longer in "Precisa de atenção"; progress 1-2-3 (Conectar conta ✓ / Configurar notificações ○ / Primeira notificação ○) with the panel instructions nested (a–d); field `max-w-md`; button "Já configurei — verificar"; after the secret, the step waits for a real notification |
| Detalhe da conexão (meta) | PASS | PASS | PASS | PASS | PASS | title "Stripe — Conta sem nome" | title = provider, or "provider — name"; Status / Ambiente / Último evento row |
| Diagnostics | PASS | PASS | PASS | PASS | — | enum-like step names; organic dots red | steps Indicação → Cliente identificado → Pagamento recebido → Cliente reconhecido → Atribuição elegível → Comissão criada; organic = grey + "Nenhuma indicação… é normal"; first missing step explained in one sentence with CTA |
| Advanced | PASS | PASS | PASS | PASS | — | see "Provider conectado" | — |
| Multi-account (Stripe Brasil/EUA) | PASS | PASS | PASS | PASS | PASS | two identical "Stripe" cards | "Stripe — Brasil" / "Stripe — EUA", group header "Stripe 2 contas", "Conectar outra conta" |
| Disconnect (dialog) | PASS | — | — | PASS | — | copy | "Desconectar Asaas — Boletos?" + "O {brand} deixará de receber novos pagamentos desta conta. Transações e comissões já registradas serão preservadas." |
| Setup wizard (Visão geral do workspace) | PASS (seen by the owner at 1440) | overflow check PASS | overflow check PASS | PASS | — | Stripe-only step; no identity step; 8 flat steps | 3 phases (Veja funcionando · Conecte seu SaaS · Produção), identity step, "Conectar um meio de pagamento", "Exemplo com a sua regra: Venda R$ 49,00 · 30% · Afiliado recebe R$ 14,70" before the technical phase |
| Docs `/documentacao` (+ `/en/docs`) | PASS | PASS | PASS | PASS | — | — (new structure) | — |
| Docs `/documentacao/beta` | PASS | PASS | PASS | PASS | — | — | `noindex, nofollow` confirmed |

Automated checks, every route above: **0 horizontal overflow**, **0 missing
i18n keys**, **0 interactive elements without an accessible name**, **0 status
dots without a word**, **1 `h1`**.

## Accessibility notes

- Tabs are links with `aria-current="page"`; `details/summary` are keyboard
  native; provider cards and selection cards are real checkboxes/links with a
  visible focus outline (`has-[:focus-visible]`).
- Status never relies on colour: every dot is beside a word; setup steps carry
  sr-only "(concluído)/(pendente)"; pipeline steps carry sr-only state; the Beta
  badge carries its meaning as `title` and sr-only text.
- The Mercado Pago steps list has `aria-label` and sr-only state per step.

## Auto-refresh audit (brief §52)

`features/integrations/auto-refresh.tsx`: one `router.refresh()` every 10 s
**only while something is awaited** (tracker's first click, first identify, a
connection's first event) and **only while the tab is visible** — hidden tabs,
background tabs and locked phones send nothing (interval stopped, not just
skipped); coming back refreshes once; stops for good after 15 minutes of
waiting; cleans the interval and the listener on unmount. The page reads are
aggregates (`billing_connection_events` over 30 days, `paymentsByConnection`
grouped), the detail reads 15 events and 8 payments — no full scans on refresh.

## Not covered

- A real "expected without commission" payment (needs an approved affiliate +
  attribution in that workspace); its branch is DB-tested
  (`multi-provider.db.test.ts` "diagnoses an attributed payment that earned
  nothing apart from an organic one") and the copy was reviewed.
- Stripe OAuth round trip (needs the platform Connect client in dev).
- Screen reader run with VoiceOver: structure checked programmatically only.

---

## Final polish pass (2026-09-18, second run)

**Method.** Public pages (`/documentacao`, `/en/docs`, `/documentacao/beta`) in
the app's built-in browser with real viewport emulation — no iframe, no header
change. Authenticated pages in the user's Chrome (signed in, `rota-digital`):
the window cannot narrow, so the iframe method was used with `X-Frame-Options:
SAMEORIGIN` / `frame-ancestors 'self'` for the run only; `next.config.ts` was
restored from a byte-for-byte backup (`cmp` identical) and the dev server
answers `X-Frame-Options: DENY` again, before the build. QA rows tagged
`metadata.qaFixture` (Stripe Brasil + EUA, Mercado Pago pending with a
60-char name, AbacatePay `invalid_credentials`, Asaas with 3 events) were
deleted afterwards (5 rows).

| ROUTE | 1440 | 768 | 375 | LIGHT | DARK | RESULT |
| --- | --- | --- | --- | --- | --- | --- |
| Integrações · Visão geral (empty) | PASS | — | — | PASS | — | "Configuração incompleta", no dot on the count |
| Integrações · Visão geral (fixtures) | PASS | PASS | PASS | PASS | PASS | "4 meios · 5 contas" · "1 item precisa de atenção" (red) · rows: Aguardando eventos ×2 (grey), Configurando (amber), Ação necessária (red), Saudável (green) |
| Pagamentos | PASS | PASS | PASS | PASS | — | "Stripe 2 contas" + "Conectar outra conta"; cards Stripe — Brasil / — EUA; MP "Falta 1 etapa no painel"; AbacatePay first issue; Asaas "Último evento há 3 minutos" |
| Rastreamento | PASS | PASS | PASS | PASS | — | brief §21 sentence |
| API | PASS | PASS | PASS | PASS | — | Identificar cliente → Referência no checkout → Avançado |
| Adicionar meio de pagamento | PASS | — | — | PASS | — | focus on search; Tab stays in the dialog; Escape returns focus to the trigger; effort labels without "webhook" |
| Mercado Pago pendente | PASS | PASS | PASS | PASS | PASS | one list 1–2–3, panel steps a–d inside step 2, copy button, "Já configurei — verificar" |
| AbacatePay erro | PASS | PASS | PASS | PASS | — | Ação necessária + inline "Salvar nova chave" |
| Asaas saudável | PASS | PASS | PASS | PASS | — | Activity/Recursos/Avançado folded with chevrons; `summary` opens with Enter |
| Stripe detail | PASS | PASS | PASS | PASS | — | see note 1 |
| Desconectar | PASS | — | — | PASS | — | initial focus on *Cancelar*; Escape closes; nothing confirmed |
| Docs guide | PASS | PASS | PASS (375/390/430) | PASS | PASS | 0 overflow; diagram wraps in a dashed group; TOC shows the active group only |
| Docs beta | PASS | PASS | PASS | PASS | PASS | now reachable signed out (was a login redirect); `noindex, nofollow` |

Automated per route and width: **0 horizontal overflow**, **0 missing i18n
keys**, **1 `h1`**. The "unnamed control" check flagged buttons inside closed
`<details>` (their text is not rendered while folded); they all have text.

**Notes**
1. The Stripe fixture was inserted as `connected` without a signing secret,
   which the real flow never produces (a manual Stripe row becomes `connected`
   only when a secret is saved), so its top status (*Aguardando eventos*) and
   the wizard (*Configuração pendente*) disagreed. Not a product state.
2. A manual Stripe connection started but never finished stays `disconnected`
   and is filtered out of the lists — pre-existing behaviour, not changed here.
3. VoiceOver was not run; structure, focus order, dialog focus and `details`
   were checked with the keyboard and programmatically.
