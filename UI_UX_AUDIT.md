# UI/UX audit — IndicaFluxo

Audit run on 2026-09-14 against the local stack (`pnpm dev`, seeded Supabase
project), after the Outlier-derived shell landed (commit `b2cb98b`). Every
public route was opened in a browser at 1440 × 900 and 375 × 812, dark and light.
Authenticated routes were reviewed in code first and then in the browser under a
founder and an affiliate session (see §3 for which were seen rendered).

Grades: **A** excellent, small tweaks · **B** good, needs polish · **C** functional,
visually weak · **D** problematic UX · **E** incomplete.

---

## 1. Route inventory

| Route (pt-br / en) | Surface | Grade | One-line verdict |
| --- | --- | --- | --- |
| `/` | Landing | **D** | Reads as a developer's product page: hero + mock + three paragraphs + four steps. No problem, no story, no two sides, no integrations, no trust, weak mobile nav |
| `/precos` · `/pricing` | Marketing | **B** | Honest, clear plans; needs to share the landing's navbar/footer and a short FAQ-free reassurance line |
| `/documentacao` · `/docs` | Marketing | **B** | Readable, numbered; fine for now |
| `/entrar` · `/login` | Auth | **C** | Centred form on an empty canvas. No show/hide password, no "forgot password", generic error copy |
| `/criar-conta` · `/signup` | Auth | **C** | Same frame; asks full name/e-mail/password (right amount). Returns raw Supabase `error.message`; e-mail confirmation state is a single line of text with no resend |
| forgot password | Auth | **E** | Does not exist |
| reset password | Auth | **E** | Does not exist |
| check your e-mail | Auth | **E** | A sentence inside the sign-up form; no resend, no "change address" |
| `/primeiros-passos` · `/onboarding` | Onboarding | **D** | One form (workspace name, currency, timezone) labelled "Passo 1 de 2", then drops the founder on a full eight-field program form with no onboarding context; the `?onboarding=1` flag it passes is ignored |
| `/[ws]/visao-geral` | Dashboard | see §3 | |
| `/[ws]/programas`, `/novo`, `/[program]` | Dashboard | see §3 | |
| `/[ws]/afiliados` | Dashboard | see §3 | |
| `/[ws]/conversoes` | Dashboard | see §3 | |
| `/[ws]/comissoes` | Dashboard | see §3 | |
| `/[ws]/pagamentos` | Dashboard | see §3 | |
| `/[ws]/integracoes` | Dashboard | see §3 | |
| `/[ws]/configuracoes` | Dashboard | see §3 | |
| `/afiliado/*` (6 routes) | Affiliate portal | see §3 | |
| `/app`, `/sair`, `/auth/callback` | Redirect-only | — | No UI |

---

## 2. Public surface

### 2.1 Landing — grade D

Evidence (1440 dark, 375 light; DOM inspected):

| Area | Finding |
| --- | --- |
| Narrative | Sections present: hero → product mock → 3 "pillars" → 4 steps → closing CTA → footer. Page is 2 849 px tall at 1440. A visitor learns *what the ledger does* but never *why they need it*: no problem section, no "what you'd have to build", no founder vs affiliate story, no integration statement. |
| Hero copy | H1 "Transforme indicações em canal de crescimento." is good. Sub-head is 47 words and mixes jargon ("ledger se preencher", "snippet") — two ideas in one paragraph. Secondary CTA goes to the docs, which is the wrong next step for a buyer (should explain how it works on the page). |
| Promises | "No ar em menos de uma hora" is a claim nothing on the page supports. "Sem processar pagamento" is phrased as a limitation, not a benefit. |
| Pillars | Three equal columns of prose, including "resolvedor determinístico" — engineering vocabulary on a sales page. |
| Steps | Four text rows, no product visual; the closing title repeats the steps ("Conecte a cobrança, escolha a comissão…") verbatim. |
| Proof | No real customers exist, and the page correctly invents none — but it also offers no product-based trust (no percentage fee, customer e-mails stored hashed, refunds reverse commissions, Stripe via Connect so no secret key). All of these are true in the code and unused. |
| Navbar | Desktop fine. **Mobile hides Pricing, Docs and Sign in with no menu** — a returning user on a phone cannot reach sign-in from the landing. |
| Footer | One sentence + three links. No product/resources grouping. |
| SEO | Title + description only. **No OpenGraph, no Twitter card, no canonical, no `hreflang` alternates** for a two-locale site. One H1 ✓. |
| Performance | Server-rendered, no client JS in the hero ✓. |
| Brand | Wordmark and copy say "Indica"; the product is IndicaFluxo. |

### 2.2 Pricing — grade B

Clear, honest ("Não ficamos com um percentual"); prices per locale in minor units
(R$ 0 / 197 / 597, $0 / 49 / 149). Shares the marketing layout, so it inherits the
mobile-nav defect. No link back to "how it works". Keep; polish chrome only.

### 2.3 Docs — grade B

Numbered reading column, code blocks framed. Section bodies render through
`t.raw` because the copy contains `</head>`. Acceptable for this phase.

### 2.4 Login — grade C

| Area | Finding |
| --- | --- |
| Composition | Centred 384 px column on an empty canvas; top bar with logo/lang/theme; tagline footer. Consistent with the product, but anonymous: nothing reminds the visitor what they are signing into. |
| Fields | E-mail + password with red asterisks (visual noise on a two-field form where both are obviously required). |
| Missing | Show/hide password · "Esqueci minha senha" · Caps Lock hint · `autocomplete="current-password"` check. |
| Errors | `badCredentials` → "Essas credenciais não funcionaram. Tente de novo." — vague; the brief asks for "E-mail ou senha incorretos." (still non-enumerating). No network-error state. |
| `?next=` | The proxy appends `next`, but `signIn` always redirects to `/app` — the reader loses their destination. |
| OAuth | Not configured (no provider env, no button) → correctly absent. |

### 2.5 Sign-up — grade C

| Area | Finding |
| --- | --- |
| Fields | Full name, e-mail, password — the right minimum ✓. |
| Password | Only rule in code is `min(8)`; hint "Pelo menos 8 caracteres." is static. No live feedback, no show/hide. |
| Errors | **`if (error) return { error: error.message }`** — raw Supabase text ("User already registered", "Password should be…") in English inside a pt-br page. |
| Confirmation | When Supabase requires e-mail confirmation the form shows one sentence; no dedicated state, no resend, no way to fix a typo'd address. |
| Value | Title "Crie sua conta" is generic; sub-head fine. Nothing about "no card required" (true: there is no card collection anywhere). |

### 2.6 Onboarding — grade D

| Area | Finding |
| --- | --- |
| Steps | Label says "Passo 1 de 2" but the second step is the regular "Novo programa" dashboard page, with no stepper, no onboarding copy, and no exit to "do it later". |
| Workspace form | Currency defaults to **USD** even for a pt-br founder (`DEFAULT_CURRENCY` exists and is unused here); timezone defaults to **UTC** instead of the browser's zone; both are shown up-front though they can be changed later. |
| Program form | Eight decisions at once (status, type, amount, recurrence, months, model, window, hold) — attribution model/window and hold period are expert settings with sensible defaults. |
| Aha moment | After creating the program the founder lands on the program detail page. There is no "your program is live", no referral link, no checklist of what is left (Stripe, tracking, first affiliate). |
| Missing key | `createProgramAction` falls back to `errors.programNotCreated`, which is **not in either catalogue**. |

---

## 3. Authenticated surface

Reviewed file by file (paths below: `D/` = `src/app/[locale]/(dashboard)/[workspaceSlug]/`,
`A/` = `src/app/[locale]/(affiliate)/affiliate/`, `pt:` = line in `pt-br.json`).

**Global:** there is no `loading.tsx`, `error.tsx` or `not-found.tsx` anywhere under
`src/app`. Every authenticated page is `force-dynamic`; only Overview has a
`<Suspense>` skeleton. Clicking a sidebar item gives no feedback until the server
answers, a thrown `AppError` shows Next's default English error screen, and
`notFound()` renders an unstyled English 404 outside the shell.

| Route | Grade | Main problems |
| --- | --- | --- |
| Shell (sidebar, header, palette) | **B** | Account menu always shows the e-mail (layouts never pass `name`); "Portal do afiliado" / "Painel do fundador" shown to people without that role → silent redirect bounce; mobile drawer does not move/trap/return focus; `⌘K` shown on Windows/Linux; no tooltip used anywhere |
| `D/visao-geral` | **C** | Six metrics in one strip (2×3 on phones); only revenue has a delta; empty gate uses 30-day windows and always CTAs "Criar um programa" — even after a program exists; chart x-labels raw ISO `09-14`; chart hover mouse-only, no text fallback |
| `D/programas` | **B** | Clean; slug in 11px instead of 12px mono; row link removes the focus ring |
| `D/programas/novo` | **B** | Ten decisions at once; hold-days error never rendered; `max(80)`/`max(500)` show Zod's English; "1 month" reopens as "first payment only"; `?onboarding=1` ignored |
| `D/programas/[slug]` | **C** | Name shown twice; tabs are full page reloads (`TabLink` is a plain `<a>`); two amber buttons on the Settings tab; lists cut at 50 with no pagination while counts show totals; hard-coded `metadata.title = "Program"` |
| `D/afiliados` | **C** | No way to act on an affiliate (approve/suspend/custom rate actions exist, no UI); invite button disappears when there is no program, leaving an empty state with no action; three verbs for one action ("Adicionar", "Convidar seu primeiro", "Convidar um"); success toast hard-coded English |
| `D/conversoes` | **D** | Capped at 100 rows, no pagination/filters, header count reads "100" as if it were the total; amber "Conectar cobrança" shown even when Stripe is connected; same rows as Commissions with no explanation |
| `D/comissoes` | **B** | Good filters/pagination/states; jargon ("engine", "lançamentos", "Elegível", "Base"); status vocabulary without a legend; misleading "Conectar cobrança" empty CTA |
| `D/pagamentos` | **C** | "Cancelar" batch submits instantly, ghost, next to "Marcar como pago"; every affiliate pre-selected on a money action; stale selection after a batch ("2 de 1 selecionados"); no batch detail; 14px checkboxes; a batch awaiting payment reads "Aprovada" |
| `D/integracoes` | **D** | Snippet copies a truncated, non-working key (plaintext only exists at creation); "Rotacionar" and "Desconectar Stripe" have no confirmation; disconnect gives no feedback; `member` role hits an unhandled error; copy full of anglicisms ("Rotacionar", "Snippet", "server-to-server", "Endpoint") |
| `D/configuracoes` | **C** | Members without e-mail ("Perfil pendente" twice is indistinguishable); disabled form for non-managers with no explanation; English currency names; raw IANA timezones; invite success hard-coded English |
| `A/visao-geral` | **B** | Good mobile hierarchy and copy button; greeting bucketed in UTC; new affiliate sees zeros with no "share your link" guidance; list wrapped in a card |
| `A/links` | **C** | Named links show no URL and no copy button — they cannot be shared; "Campanha" column always "—"; page repeats card + table + form per program |
| `A/conversoes` | **C** | Near-duplicate of Commissions, capped at 100 |
| `A/comissoes` | **B** | Good; negative amounts without sign; no status legend |
| `A/pagamentos` | **B** | Title differs from nav label; reference not mono |
| `A/configuracoes` | **C** | Read-only; says "we keep the minimum to pay you" but has no payout details |

---

## 4. Cross-cutting findings

### 4.1 Inconsistency (pages built in separate passes)

- **Three mobile list strategies:** hidden table cells with a stacked first cell (programs, affiliates, program detail, payouts); a duplicate `<ul md:hidden>` beside the table (four portal pages); plain horizontal scroll (commissions, conversions, overview).
- **Five section-heading styles:** `SectionHeader`, hand-written `h2` in integration panels, `FormSection` (duplicated in two files), `CardTitle`, `h2 text-title`.
- **Four key/value strip styles:** `Metric`, program-detail `SummaryItem`, Stripe `dl`, affiliate-settings `dl`.
- **Four inline-alert styles** (bordered, boxed, plain caption, plain meta).
- **Three code-and-copy fields** (`ReferralLinkField`, boxed rows in integrations, bare code).
- **Filter bar and pagination** copy-pasted between affiliates and commissions; the two `pageOf` strings differ.
- **Vocabulary drift:** duration labels defined four times with different capitalisation; hold period is "retenção" in-app and "carência" on the landing; brand "a Indica" inside the app.

### 4.2 Feedback

- `useActionResult` de-duplicates by message text: the second identical success or error in a row is silently dropped.
- Several forms show the same error inline *and* as a toast.
- Button loading adds a spinner beside the label and changes width (DESIGN says keep width).
- `Field` creates `-error`/`-hint` ids but only one form wires `aria-describedby`.
- Toasts are bottom-right on phones (DESIGN: bottom-centre).

### 4.3 First-visit founder experience

Workspace → "Novo programa" (no step 2 UI) → program detail full of zeros →
Overview empty state whose only action is "Criar um programa" → Integrations with
a snippet that does not work. Stripe and tracking are never mentioned along the
way. Every activation signal needed for a checklist is available from existing
read functions (`listPrograms` click/affiliate counts, `listIntegrations`,
`getWorkspaceForUser`), no new SQL required.

### 4.4 Visual debt

- Hard-coded colour: the select chevron SVG uses the dark-theme muted hex in both themes; `destructive` button uses `text-white`.
- Arbitrary values: fixed menu widths (`w-[232px]`, `w-[240px]`, `w-[200px]`), `max-w-[480px]` dialog without `max-h`, three ad-hoc z-indices, `max-w-[68ch]` ×5 vs `max-w-prose`.
- Dead code: `ErrorState`, `StatusDot`, `CardDescription`, Radix `Tabs*`, `Tooltip` consumers, button `destructive`/`link`/`xs` variants; catalogue keys `nav.affiliateSections`, `palette.goTo`, `success.inviteSent|affiliateAdded|affiliateUpdated|batchCreated` (the last four exist while actions hard-code English).
- No `text-[`, `p-[` or `rounded-lg/xl` found.

---

## 5. Priorities for this phase

| P | Work | Why |
| --- | --- | --- |
| P0 | Landing rebuilt as a sales narrative; mobile nav; SEO | Grade D; the first thing a buyer sees |
| P0 | Auth: shared layout, show/hide + caps lock, forgot/reset, check-e-mail state, human errors, `?next` | Grades C/E; raw Supabase errors; no recovery path |
| P0 | Onboarding: 3-step flow, reduced program form, activation checklist on Overview | Grade D; no aha moment |
| P1 | `loading.tsx` / `error.tsx` / `not-found.tsx` for dashboard and portal | No feedback on navigation; English error screens |
| P1 | Destructive confirmations (cancel batch, rotate key, disconnect Stripe) | Money and integration actions one click away |
| P1 | Hard-coded English and missing field errors in actions and forms | Mixed language, silent validation |
| P1 | Integrations: honest snippet state ("generate a key to reveal it") | Core setup step is broken today |
| P1 | Overview hierarchy, Conversions honesty, Payouts selection defaults | Grades C/D |
| P2 | Portal: named link URLs + copy, affiliate empty guidance, settings copy | Affiliates cannot share named links |
| P2 | Consistency: one mobile list pattern, one alert, one section heading, jargon pass | "Built by different agents" feel |

Items that need backend or data changes are recorded in
`UI_UX_FUNCTIONAL_FINDINGS.md` and are not changed in this phase.

---

## 6. Outcome of this phase

Grades re-assessed after the polish pass, against the same criteria. "Seen"
means verified in a browser; see `POLISH_CHECKLIST.md` for the per-route boxes.

| Route | Before | After | What changed |
| --- | --- | --- | --- |
| Landing | D | A− | Rebuilt as a sales narrative with product-only visuals, mobile menu, footer groups, SEO + OG image, brand IndicaFluxo |
| Pricing | B | A− | Shared chrome, "Grátis", canonical/hreflang |
| Docs | B | B | Chrome and SEO only |
| Login | C | A− | Split layout with product proof, show/hide, Caps Lock, forgot link, human errors, `?next` |
| Sign-up | C | A− | Value title, live password requirement, check-e-mail state with resend |
| Forgot / reset password | E | B+ | New flows; need Supabase redirect configuration to work end to end |
| Onboarding | D | B+ | Three steps, locale defaults, reduced program form, activation checklist (checklist not seen rendered) |
| Overview | C | B+ | Four-metric hierarchy, localised chart, honest funnel rates, full-row headline on phones |
| Programs | B | A− | Focus ring, 12px identifiers, attribution definition |
| Program detail | C | B+ | No duplicate name, capped lists labelled, single amber per tab, definitions |
| Affiliates | C | B+ | One verb, actionable no-program state, form dialog with inline errors |
| Conversions | D | B | Honest cap label, explained vs Commissions, correct empty CTA (pagination still missing) |
| Commissions | B | A− | Plain vocabulary, definitions, shared pagination |
| Payouts | C | B+ | No pre-selection, confirmed cancel, batch wording, e-mail on payable rows |
| Integrations | D | B+ | Honest key/snippet flow, confirmations, feedback, plain Portuguese |
| Settings | C | B+ | Translated currency/timezone names, read-only explanation, shared form sections |
| Affiliate overview | B | A− | Earnings-first hierarchy, first-run guidance, participation notice |
| Affiliate links | C | A− | Named links shareable, collapsed create form |
| Affiliate conversions / commissions | C / B | B+ / A− | **Were always empty (RLS join) — fixed**; differences explained; status definitions |
| Affiliate payouts / settings | B / C | A− / B | Wording, mono references, honest settings copy |
| Route states (loading/error/404) | E | A− | Added for dashboard, portal and the locale root |
