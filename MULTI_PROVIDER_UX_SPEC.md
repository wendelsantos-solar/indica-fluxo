# MULTI_PROVIDER_UX_SPEC.md

UX of "integrate once, connect every provider". Every screen below exists in
code; file paths point at it. Visual rules are DESIGN.md's (Linear-derived,
hairlines, monochrome primary, status colour only as a dot beside a word).
Copy lives in `src/i18n/messages/{pt-br,en}.json` under
`dashboard.integrations.*` (server) and `forms.billing.*` (client).

Language rule (brief §37): the main view says **meio de pagamento, conta
conectada, eventos de pagamento, clientes**. "Webhook", "billing connector",
event names and ids only appear in *Configurações avançadas* and in the docs.

---

## 1. Integration Overview

`/[ws]/integracoes` (tab Visão geral) — `integrations/page.tsx`

| | |
| --- | --- |
| **Objective** | Answer "does it work, and what is left?" in one screen |
| **Primary action** | The next unfinished setup step's link |
| **Secondary** | Save provider choice · Gerenciar (→ Pagamentos) · Simular conversão |
| **Structure** | Summary strip (Rastreamento · Identificação de clientes · Meios de pagamento · Saúde) → Configuração checklist (`{done} de {total}`) → "Como seu SaaS recebe pagamentos?" → connection cards → Testar integração |
| **Empty** | Strip shows "Aguardando" / "Nenhum conectado" / "—"; checklist all pending; cards area says what connecting enables |
| **Loading** | Route skeleton (`[workspaceSlug]/loading.tsx`); while the tracker, the first identify or a first event is awaited, `AutoRefresh` re-reads every 10 s (paused when the tab is hidden) — no "I installed it" button |
| **Success** | "Tudo pronto para produção" when tracker + customer link + ≥ 1 provider with events; remaining providers stay listed as *Opcional* |
| **Warning** | Health cell "N precisam de atenção"; card shows the first issue sentence |
| **Error** | Same as warning with a danger dot; details on the connection page |
| **Mobile** | Strip becomes 2×2; checklist and cards single column; tabs scroll horizontally |
| **Accessibility** | Tabs are a `nav` with `aria-current`; checklist state has sr-only "(concluído)/(pendente)"; dots are always next to a word |

Setup rules (`features/integrations/setup.ts`, tested): READY never needs every
provider; one chosen provider is required, the rest are optional; a provider
connected but not chosen still appears.

## 2. Provider Selection

Inside Overview — `provider-selection.tsx`

| | |
| --- | --- |
| **Objective** | "Como seu SaaS recebe pagamentos?" — the founder thinks in payments, not APIs |
| **Primary action** | Salvar escolha |
| **Secondary** | none — "pode deixar um provedor para depois: nada fica bloqueado" |
| **States** | Real checkboxes styled as cards (multi-select, never radio); selected = stronger hairline + check; Beta badge; *Em breve* disabled |
| **Success** | Inline status line "Escolha salva." (no toast) |
| **Error** | InlineAlert under the grid |
| **Mobile** | One column |
| **Accessibility** | `fieldset` + `legend`; native checkbox focus ring on the card; disabled for members (read-only) |

## 3. Connect Provider

Dialog — `add-provider-dialog.tsx` (from Pagamentos header, empty state, or "Conectar outra conta")

| | |
| --- | --- |
| **Objective** | Pick a provider and connect it without leaving the page |
| **Primary action** | Conectar {provider} |
| **Secondary** | Search, back to list |
| **List** | Monogram + name + **honest effort label**: Stripe "Autorizar no Stripe · webhook automático" (OAuth configured) or "ID da conta + 2 etapas no Stripe"; Mercado Pago "Token de acesso + 1 etapa no painel"; AbacatePay / Asaas "Chave de API · webhook automático". Beta badge; *Em breve* is text, not a button |
| **Form** | Optional account name · key as password input with show/hide · "A chave é criptografada ao salvar e nunca é exibida de novo." (true: AES-256-GCM, never returned) |
| **Loading** | Button spinner keeps its width; one live line naming the **real** step running ("Validando a chave e registrando o webhook no Asaas…") — no simulated multi-step animation |
| **Success** | Navigates to the new connection's page; nothing is green before the backend confirmed (brief §63) |
| **Error** | InlineAlert "Não conectamos o {provider}" + what happened + what to do (`errors.billing.*`: refused key, webhook not allowed, provider down, duplicate account). A refused first connect leaves no row behind |
| **Mobile** | Dialog full width; inputs 40 px / 16 px text |
| **Accessibility** | Radix dialog focus trap; icon buttons labelled; pending status `aria-live="polite"` |

## 4. Provider Card

`connection-card.tsx`

| | |
| --- | --- |
| **Objective** | One account at a glance |
| **Shows** | Provider · account name · mode (Teste / Produção / Teste e produção) · one health badge · last event, or the first issue |
| **Never shows** | client id, webhook id, secrets (→ advanced) |
| **Primary action** | The card itself opens the detail |
| **States** | Saudável · Aguardando eventos · Requer atenção · Ação necessária · Com erro |
| **Mobile** | Grid collapses to one column |
| **Accessibility** | One focusable link per card with visible focus outline |

Payments tab groups cards by provider; a provider with several accounts shows
"N contas" and "Conectar outra conta" (multi-account is visible, brief §42).

## 5. Provider Detail

`/[ws]/integracoes/[connectionId]` — `[connectionId]/page.tsx`

| | |
| --- | --- |
| **Objective** | "Is it healthy? If not, why, and what do I do?" |
| **Order** | Identity line (provider, Beta, health, account · mode · last event) → **Precisa de atenção** (what happened / what it affects / what to do, with the fix inline: reconnect form for a refused key) → Mercado Pago panel step when pending → **Status** (Autorização, Eventos de pagamento, Leitura dos eventos, Clientes, Atribuição, Comissões) → Stripe setup (existing wizard, scoped to this account) → Últimos pagamentos → Eventos recentes → O que este provedor permite → *Configurações avançadas* (folded) |
| **Primary action** | Depends on the issue (reconnect, paste Mercado Pago secret) |
| **Advanced** | Connection id, provider account, mode, webhook (registered by the product / manual), last event type, last reason, endpoint with copy, rename, rotate key, disconnect |
| **Disconnect** | Quiet danger button → confirm dialog "Desconectar {name}?" + "Novos eventos deixarão de ser recebidos. Transações e comissões existentes não serão apagadas." Audited |
| **Loading** | Route skeleton; `AutoRefresh` while "Aguardando eventos" |
| **Empty** | "Nenhum pagamento do {provider} registrado ainda." / "Nenhum evento recebido." |
| **Mobile** | Single column; event rows wrap; advanced grid one column |
| **Accessibility** | Pipeline states have sr-only words; `details/summary` is keyboard native |

Signature failures are never shown as "401 WHSEC": the issue reads "O {brand}
não conseguiu validar os eventos do {provider}. Reconecte sua conta…" and the
technical detail sits under advanced (brief §34).

## 6. Diagnostics

Detail sections "Últimos pagamentos" and "Eventos recentes" — `connection-health.ts`

- **Pipeline per payment**: Clique → Atribuição → Cliente → Identidade no
  provedor → Evento → Transação → Comissão, each a dot + word.
- **Classification**: *Comissão gerada* (success), *Orgânico* (neutral — a
  customer nobody referred is normal and never alerts), *Indicado sem comissão*
  (warning — a customer with a live attribution paid and earned nothing), with a
  sentence pointing at the reason.
- **Events**: raw type (mono), outcome (Processado / Sem efeito / Falhou) and the
  reason in words (`reasons.*`: "cliente sem indicação", "indicação expirada",
  "ambiente errado", "pagamento sem cliente", …).

## 7. Test Integration

Overview section "Testar integração"

1. Abra seu site por um link de indicação e crie uma conta de teste.
2. Pague com o meio de pagamento em modo de teste.
3. Abra o meio de pagamento em Pagamentos: cada etapa aparece em "Últimos pagamentos".

"Prefere sem cobrança nenhuma? Simule uma conversão" → the existing sandbox
simulation (real services, no provider). Per-provider test strategy is stated
on the detail page (Mercado Pago's test credentials send no notifications — the
panel simulator or a small real payment is the honest route).

## 8. Setup Complete

Overview success alert: "Tudo pronto para produção — O rastreamento, a
identificação de clientes e pelo menos um meio de pagamento estão funcionando.
Outros meios de pagamento podem ser adicionados quando quiser." Not gated on
every provider; no timer or time claim is shown (none is measured yet).

---

## Tabs (brief §38)

Visão geral · Pagamentos · Rastreamento (tracker tag + keys) · API (identify +
"Referência no checkout" — the universal bridge, one sample per provider
generated from `checkoutFields`). Sidebar unchanged.

## What the UI deliberately does not do

- No provider logos (brand guidelines not cleared) — monogram + name.
- No fake progress animation; only the step the backend is actually running.
- No green before the backend confirms; "connected" ≠ healthy.
- No alert for organic payments.
- Beta providers are labelled in the product and absent from the public site.

---

## Revisions after the real visual QA (2026-09-18)

See `MULTI_PROVIDER_VISUAL_QA.md` for the evidence. What changed:

- **Page subcopy**: "Instale o {brand} uma vez e conecte os meios de pagamento
  que seu SaaS utiliza." Founder UI says *meio de pagamento*; "provider",
  "billing connector" stay in the advanced docs and API.
- **Overview order**: summary (`{brand} instalado` · `Identificação do cliente`
  · `Meios de pagamento` · `Status geral`) → *Seus meios de pagamento* (compact
  rows: name, Beta, status) → setup checklist (while not ready) → *Como seu SaaS
  recebe pagamentos?* folded once answered → Testar integração.
- **Selection**: adds **Outro** (stored as `other`, never a connection) with an
  honest note: payments through it do not reach the product.
- **Status vocabulary** (semantic tokens only): Saudável (success) · Configurando
  (warning) · Requer atenção (warning) · Ação necessária (danger) · Erro (danger)
  · Desconectado (neutral) · Beta (neutral badge, always with its meaning) · Em
  breve (text, no CTA).
- **Setup step per provider** ticks only with a working connection; otherwise
  it says *waiting for the first event*, *1 step left in the Mercado Pago
  panel* or *needs attention*.
- **Tracking tab**: Rastreador / Identificação do cliente with evidence and the
  one-line explanation of why identity makes every payment method work.
- **Detail**: Status · Ambiente · Último evento → Beta callout → Precisa de
  atenção (never "waiting", which is a state) → Mercado Pago steps 1-2-3 →
  Saúde → Diagnóstico → *Atividade*, *Recursos*, *Configurações avançadas*
  folded.
- **Diagnostics**: Indicação → Cliente identificado → Pagamento recebido →
  Cliente reconhecido → Atribuição elegível → Comissão criada; organic = "Sem
  indicação", grey, never red; the first missing step explained in one
  sentence; reason codes shown as sentences.
- **Onboarding** (workspace overview): three phases — *Veja funcionando*
  (program, affiliate, simulated conversion + "Exemplo com a sua regra") →
  *Conecte seu SaaS* (tracker, identify, payment method) → *Produção*.

### READY (derived, `features/integrations/setup.ts`)

```
READY = tracker detected (a real, non-simulated click)
      + customer identity detected (an identify, or a reference bound by a payment)
      + at least one connection that is working (healthy or degraded) and has delivered an event
```

Other chosen payment methods are *Opcional* and never block READY. "Production
ready" for a *provider* is a different thing: see
`PROVIDER_PRODUCTION_VALIDATION.md`.

---

## Final polish (2026-09-18, second pass)

One idea everywhere: *integre uma vez, depois conecte onde recebe*.

- **Status geral is derived, never counted** (`workspaceStatus`,
  `features/integrations/health.ts`, tested): *Tudo funcionando* only when the
  tracker, customer identity and every account work; *N itens precisam de
  atenção* (danger if something is broken, warning if only degraded);
  *Configuração incompleta* while the tracker, identity or a founder-only step
  is missing; *Aguardando eventos* when everything is set and no payment came
  yet. The *Meios de pagamento* cell is a count with no dot: "4 meios · 5 contas".
- **Aguardando eventos ≠ Configurando** (`connectionDisplayState`, tested): a
  connection whose only gap is the first payment shows *Aguardando eventos*
  (neutral); *Configurando* (warning) is kept for a step only the founder can
  do (Mercado Pago's panel). The card no longer repeats "aguardando" as an
  issue line. Vocabulary: Saudável · Configurando · Aguardando eventos · Requer
  atenção · Ação necessária · Erro · Desconectado · Beta · Em breve.
- **Mercado Pago**: one numbered list (1 Conta conectada ✓ · 2 Configurar
  notificações · 3 Primeira notificação); the panel instructions (a–d: URL with
  copy, topics, secret, *Já configurei — verificar*) live **inside** step 2;
  step 3 says how to trigger the first notification.
- **Stripe**: when OAuth is configured the dialog leads with *Autorizar no
  Stripe* + one sentence; the manual form (account id → endpoint → secret)
  stays one fold away under *Configurar manualmente*.
- **API tab** by use case: Identificar cliente → Referência no checkout →
  *Avançado* (atribuição avançada, erros, pagamento sem comissão — links into
  the guide).
- **Rastreamento** explainer is the brief's sentence: "A indicação fica ligada
  ao cliente antes do pagamento…".
- Founder copy no longer says *provedor* (selection note, key errors, rotation
  hint, disconnect toast); *meio de pagamento* throughout.
- Beta callout on a connection: "Esta integração está em validação com contas
  reais. A arquitetura e os eventos já estão implementados, mas recomendamos
  testes antes de usar em produção."
