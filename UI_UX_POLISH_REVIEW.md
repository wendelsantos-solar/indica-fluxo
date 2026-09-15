# UI/UX polish review — third pass

Review of every surface after the redesign, the polish phase, the functional
fixes and the docs rebuild (commit `133e1db`). The goal is what still keeps
IndicaFluxo from feeling like a mature, paid B2B product — not a restatement of
earlier audits.

**How it was checked**

- **Public pages** (landing, pricing, docs, login, sign-up, forgot/reset, 404):
  opened in the browser at 1440 light and dark, 390 dark/light; landing also in English.
- **Signed-in pages** (founder dashboard, affiliate portal, onboarding step 2+):
  reviewed in the current source, file by file. Visual verification was not
  possible this time — the temporary development impersonation used in earlier
  passes was refused by the environment's safety policy. Screenshots of
  Afiliados, Pagamentos, lote, Integrações, Links (portal) from the previous
  pass (same code) were used where they apply.
- Three code-inferred issues were confirmed directly in source (overlay z-index,
  batch page width, no invite e-mail).

Severity: **High** — misleads, blocks, or breaks trust · **Medium** — friction or
inconsistency a paying user notices · **Low** — finish.

---

## 1. Top 12 — highest impact

| # | Item | Sev | Effort | Why it matters |
| --- | --- | --- | --- | --- |
| 1 | **Pricing promises what the product does not have.** Plans list "Até 10 afiliados", "Programas ilimitados", "Suporte prioritário", "Retenção de dados estendida", "Múltiplos workspaces" — there is no plan, limit, upgrade path or billing anywhere in the code, and every paid plan's button says "Começar grátis". The landing repeats the preview. | High | S (copy) / L (plans) | A buyer who reads the pricing as a contract finds none of it enforced; a legal and trust problem, not a visual one. Either mark plans as "em breve / acesso antecipado" and keep one honest free offer, or build plans |
| 2 | **"Convite enviado" — no invite is sent.** No mailer exists outside auth; invites only insert rows. Success copy, "Enviar convite", "Convite enviado em {date}" and the checklist ("recebe… na hora") all claim otherwise, and the founder gets no link to forward. | High | S copy / M link | Activation depends on the first affiliate. Founders wait for sign-ups that cannot happen |
| 3 | **Phones: account menu and workspace switcher open behind the drawer.** Drawer `z-[90]`, dropdown portals `z-50` (`app-shell.tsx:289`, `dropdown.tsx:24`). Theme, language, portal switch and sign-out are unreachable on mobile except via ⌘K. | High | S | Basic account actions broken on the device affiliates use most |
| 4 | **"Stripe conectado" before anything works.** Status turns connected when an `acct_…` id is pasted; the checklist ticks it too. No "último webhook recebido" or "último clique" is shown although `webhook_events` records it. (Related: DOCS_TECHNICAL_FINDINGS T1.) | High | M | "Está funcionando?" is the founder's first question; a green badge with no data behind it destroys trust when no commission arrives |
| 5 | **A quiet month hides the dashboard.** Overview shows the activation checklist whenever the last 30 days have no clicks/revenue — even for a fully set-up workspace with money owed. The page never says its period; "Afiliados ativos" is all-time next to 30-day metrics. | High | S | An established account suddenly looks new and the "prontos para pagar" callout disappears |
| 6 | **No way to drill into one affiliate.** Names are not links; Commissions/Conversions cannot filter by affiliate. | High | M | Every support conversation is about one affiliate's earnings |
| 7 | **No payout export.** The product says "você paga pelos seus próprios meios" but offers no CSV/copy of name, e-mail, amount for a batch; creating a batch does not lead to it. | High | M | The monthly payout is retyped by hand into a bank |
| 8 | **Portal "A receber" does not say when.** One number mixes pending, available and approved; the chart is hover-only on a phone-first page. | High | S–M | Generates "cadê meu dinheiro?" messages to the founder |
| 9 | **Workspace timezone does nothing.** Collected in onboarding and settings; every date, 30-day window and batch month is UTC. A 22:00 São Paulo conversion shows the next day. | Medium | M | Off-by-one dates in a ledger undercut "números que batem" |
| 10 | **Table baseline.** No sorting anywhere; filters need "Aplicar" and full-page GET reloads; Commissions has no occurrence date; DESIGN §13 sticky first column + edge fade not implemented. | Medium | M–L | Ranking, filtering and reconciling are the core jobs |
| 11 | **Loading fidelity.** One list skeleton for form pages; skeleton headers lack the description line (≈40 px jump); program-detail tabs give no pending feedback and reload all tabs' data. | Medium | S–M | Layout jumps and silent waits read as "slow/unfinished" |
| 12 | **Silent consequential edits.** Program status (pause/archive stops crediting for every affiliate) and currency change save without confirmation or consequence text. | Medium | S | One select silently stops everyone's earnings |

---

## 2. Public pages (seen in browser)

### Landing
- **Medium — problem headline too heavy.** "Seu SaaS não deveria precisar construir um sistema de afiliados." at 48 px in a 5/12 column wraps to five lines at 1440 px and dominates the section. Use `heading-sm` in that column or widen it.
- **Low — hero notification bleeds into the next section.** The floating "Nova conversão" card (`-bottom-8`) peeks above the "Do clique à comissão" band at 1440 px. Keep it inside the hero frame.
- **Low — thin footer group.** "Materiais" holds a single link (Documentação). Merge into "Produto" until there is a second resource.
- **Low — naming drift.** Nav "Documentação", docs bar "Docs", footer "Documentação"; nav "Produto" anchors to a section titled "Produto" but the footer calls it "Recursos".
- **Low — principles row reads faint.** Four columns of 13 px text with 16 px icons at 1440 px have little weight next to the sections around them; consider two columns with body-sm.
- English hero and layout hold up; no overflow at 390.

### Pricing
- **High — see Top 1** (unimplemented plan features; "Começar grátis" on paid plans).
- **Medium — anglicisms in plan features:** "Tracking de cliques", "Ledger de comissões", "log de auditoria".
- **Low — no "what happens after free"**: no line explaining that everyone starts on Starter and how/when to move (there is no path today).

### Auth (login, sign-up, forgot, reset)
- **Medium — split is unbalanced at 1440 px.** Left statement is small and the proof card ~300 px wide, leaving a large empty canvas; the form column starts at a different height than the statement. Centre both columns on the same baseline and let the proof card grow.
- **Low — `?error=link` notice has no action.** "Esse link expirou ou já foi usado. Peça um novo." should link to "Esqueci minha senha" (the reset page's expired state already does this well).
- Reset "Link expirado" state, show/hide password and "Esqueci minha senha" all read well.

### Docs
- Good after the rebuild. Remaining content risks are technical (DOCS_TECHNICAL_FINDINGS T1, T3, T6), not visual.

---

## 3. Signed-in app (source review)

`D/` = `src/app/[locale]/(dashboard)/[workspaceSlug]/`, `A/` = `src/app/[locale]/(affiliate)/affiliate/`.

### Shell
- **High** — drawer/dropdown z-index (Top 3).
- **Medium** — tablet rail (768–1023 px): workspace switcher and logo render name + chevron in a 56 px rail and overflow; with the desktop sidebar collapsed the switcher is hidden. Needs an initials-only trigger.
- **Medium** — "Buscar" opens a command list that searches nothing but commands; only one creation command ("Criar programa"). Rename to "Comandos" or add programs/affiliates/batches results and "Convidar afiliado", "Criar lote".
- **Low** — redundant native `title` tooltips on visible nav labels; sidebar brand text at 590 is the heaviest text on screen.

### Route states
- **Medium** — generic list skeleton on Settings, Integrations, Novo programa, Programas, Pagamentos; skeleton header without description line.
- **Low** — dashboard error page has no `<h1>` (portal's does); not-found primary vs secondary button differs between surfaces; error copy blames the role for every failure.

### Visão geral
- **High** — quiet-month gate and unstated period (Top 5).
- **Medium** — chart has no value axis and hover-only tooltips; funnel "Testes" counts all subscriptions (not referred) and "Cadastros" is 0 without identify — hide steps with no source, rename to "Assinaturas"; "Conversões recentes" lacks a date and rows link nowhere.
- **Low** — skeleton always shows the has-data layout and 2 of 4 metrics below `lg`; checklist "Instalar o tracking" links to the top of Integrations instead of `#tracking`.

### Programas / Novo programa / Programa
- **Medium** — program form keeps a local `FormSection` with different grid/padding from the shared one (forms don't align across pages).
- **Medium** — detail hierarchy: configuration strip first, performance second and visually identical; lead with performance.
- **Medium** — tabs: no pending state, all tabs' data loaded on every tab.
- **Medium** — status/currency changes without confirmation (Top 12); no row actions on the affiliates tab; missing `websiteUrl` not flagged to the founder while every affiliate sees "Link padrão indisponível".
- **Medium (copy)** — "Descrição… exibida aos afiliados no portal deles": the portal never renders it.
- **Low** — no Cancel on the full create form; currency select shows bare codes; commissions tab lacks a date; detail skeleton shape differs.

### Afiliados
- **High** — no drill-down (Top 6).
- **Medium** — no sorting; pending approvals hidden in "…" with no pending count or inline Approve; filters need "Aplicar" + full reload.
- **Low** — `?page=2.5` not rounded; a page past the end shows the first-run empty state; "Conversão" column name reads as a count; invite dialog special rate is percentage-only while the row action supports fixed amounts.

### Convites (Afiliados, Configurações, checklist)
- **High** — no e-mail is sent (Top 2).

### Conversões / Comissões
- **Medium** — Conversions has no filters at all; Commissions has no occurrence date; sticky first column / edge fade missing on financial tables.
- **Low** — "Pagamento" column clashes with "Pagamentos" (payouts); the same amount is "Valor base", "Venda" and "Valor pago" on different pages; `program` param unvalidated; truncated transaction id links nowhere; no link from a paid commission to its batch.

### Pagamentos / Lote
- **High** — no export; batch creation doesn't lead to the batch (Top 7).
- **Medium** — batch detail renders at full content width: `max-w-detail` on a direct child is overridden by the shell's `[&>*:not([data-page-header])]:max-w-content` (confirmed; other detail pages wrap it in a `<div>`).
- **Low** — English stored reference ("September 2026") used as the `<h1>` and dialog title; amber checkboxes beside the amber submit; "Disponível para pagar" vs "Prontos para pagar" for the same amount.

### Integrações
- **High** — "Conectado" without verification (Top 4).
- **Medium** — once a public key exists, getting the tracking code again requires generating a new key, which breaks the installed one.
- **Low** — five different key/value styles across Stripe, batch, portal settings, metrics, program rules; English leaking ("tracking", "snippet").

### Configurações
- **Medium** — timezone setting unused (Top 9); team section can only invite (no remove, role change, revoke/resend).
- **Low** — "conta 3f2a9c1b" exposes an internal id; lowercase "convidado · Admin"; timezone labels differ between onboarding (raw IANA) and settings (friendly names).

### Onboarding
- **Medium** — step 1 is a bare page, step 2 sits inside the full dashboard shell with sidebar (invites wandering off mid-flow); workspace error uses a hand-styled paragraph instead of `InlineAlert`.
- **Low** — "Voltar ao painel" always goes to the first workspace; required-field markers inconsistent between forms.

### Portal
- **High** — "A receber" without release timing; hover-only chart (Top 8).
- **Medium** — payout labels "Paga/Pendente/Cancelada" (feminine) for "pagamento", and different from the founder's "Pago/Aguardando pagamento".
- **Low** — status labels differ from the founder's for the same participation ("Rejeitada" vs "Recusado"); "Compartilhe seu link" guidance sits below the link; named links can't be edited or deleted; no filters on portal Comissões; status definitions duplicated (tooltip + legend); "Disponível em" vs founder's "Liberada em"; account name taken from the first program only; one stats query per program.

---

## 4. Cross-cutting consistency

- **Vocabulary** — fixed rate unit: "por conversão" / "por venda" / "por pagamento"; commission "Aprovada" (= in a batch) collides with affiliate "Aprovado" ("Em lote" is clearer); program creation: "Novo programa" / "Criar programa" / "Criar seu primeiro programa".
- **Copy tone** — developer phrasing in user errors: "Essa operação conflita com o estado atual.", "Requisições demais."; grammar in `forms.batch.confirmBody` ("você pagou {count} afiliados um total de {amount}" → "você pagou {amount} a {count} afiliados").
- **Spacing** — sections mostly `space-y-10` (40 px), while DESIGN §4 allows 32/48; program detail (32) and portal links (48) drift from the rest. Pick one and document it.
- **Dialogs** — `max-w-md`/`max-w-xl` (448/576 px) vs DESIGN's 480/560.
- **Empty tables** — Overview puts "no data" rows inside tables; everywhere else uses `EmptyState`.

---

## 5. Suggested order of work

1. **Honesty fixes (S, same day):** pricing copy (#1), invite copy (#2), "Conectado" wording until verification exists (#4), description hint, `?error=link` link.
2. **Broken on mobile / layout (S):** overlay z-index scale (#3), batch detail width, tablet rail trigger, overview gate + period label (#5).
3. **Founder operations (M):** affiliate filter + links (#6), payout CSV + redirect to batch (#7), Integrations "último webhook / último clique" (#4), confirmation on program status/currency (#12).
4. **Affiliate trust (S–M):** released vs on hold with next release date, tap-friendly chart (#8), payout labels.
5. **Tables & time (M–L):** sorting, apply-on-change filters, occurrence dates, sticky first column (#10); apply workspace timezone (#9).
6. **Finish (S):** skeleton fidelity and tab pending state (#11), vocabulary and spacing unification, landing problem headline and hero notice, auth split balance.

Items 1–2 are copy and CSS; 3–5 touch reads and small features; none requires a schema change except, optionally, plan enforcement (#1) and verified integration status (#4, which can read existing `webhook_events`).

---

## 6. Resolution (this pass)

Implemented after the review. Signed-in screens were verified by typecheck,
unit tests, database reads under RLS as a real member (in rolled-back
transactions) and route resolution — not by a signed-in browser session, which
this environment cannot open. Public pages were re-checked in the browser at
1440 and 390.

| # | Item | Status |
| --- | --- | --- |
| 1 | Pricing honesty | **Done** — two real plans (`workspaces.plan`, column grant against self-upgrade, migration 0006); Starter limits enforced in services; plan usage + upgrade request + audit log in Settings; pricing renders from `src/lib/plans.ts`. See LANDING_CLAIMS_AUDIT.md |
| 2 | Invites not sent | **Done** — Supabase invitation e-mail + copyable link; existing accounts claimed at sign-in (migration 0008); team management (role, remove, revoke, resend) |
| 3 | Overlays behind the drawer | **Done** — z-index scale tokens; test fails on arbitrary `z-[…]` |
| 4 | "Stripe conectado" unverified | **Done** — per-workspace endpoint + signing secret; status from the latest webhook event (migration 0007 `latest_webhook_event`); checklist ticks after the first event |
| 5 | Quiet-month gate | **Done** — checklist only while setup is incomplete and nothing was ever recorded; period stated |
| 6 | Affiliate drill-down | **Done** — affiliate detail page; affiliate filters on Conversions/Commissions; conversion trail page |
| 7 | Payout export | **Done** — CSV (BOM, locale delimiter, formula-safe) + copy as table; creating a batch opens it |
| 8 | Portal "A receber" | **Done** — Disponível / Em retenção (next release) / Em lote; accessible chart summary |
| 9 | Timezone unused | **Done** — dates, overview windows and day buckets, period filters and batch month in the workspace zone; portal stays UTC (multi-workspace) |
| 10 | Table baseline | **Done** — sortable headers, filters apply on change, occurrence date, sticky first column, pagination clamp |
| 11 | Loading fidelity | **Done** — skeleton headers with description; form/detail skeletons; tab pending state, active-tab-only reads |
| 12 | Silent program edits | **Done** — confirmation with the real consequence (pause stops new attributions, not existing customers' commissions) |

Per-route items in §2–§4 were addressed by the same work: tablet rail
initials trigger, real palette search, chart axis and funnel sources, program
detail hierarchy and missing-site notice, batch width and localised batch
names, members' read-only payouts, integration key copy, internal ids removed
from team, onboarding focus frame, portal vocabulary and named-link editing,
landing problem headline, hero notice, footer groups, auth split balance,
`?error=link` action, and one term for the hold period ("retenção").

**Deliberately not done:** sorting on phones (table header hidden), a link from
a paid commission to its batch in the Commissions table (the conversion trail
has it), searching batches by localised month name.
