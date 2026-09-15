# Landing claims audit

**Rule:** the landing (`/`), the pricing page (`/precos`, `/pricing`), their
meta descriptions and the auth proof card may state only what the code proves.
Plans follow `docs/PLANS.md`; the feature status behind each row is in
`PLAN_FEATURE_AUDIT.md`.

This table replaces the previous audit (written when there were two plans,
Starter and Growth, and no checkout). Every public sentence that states a
benefit, a limit, a price or a billing rule is listed with the file that makes
it true.

Verdicts: **TRUE** — the code delivers it as worded · **REWORDED** — the old
wording overpromised or was out of date; the new wording is true ·
**DERIVED** — rendered from `src/lib/plans.ts` through `src/lib/plans-display.ts`,
so it cannot drift from enforcement (asserted in
`src/lib/__tests__/plans-display.test.ts`).

## Prices, plans and limits

| Public claim | Evidence | Verdict |
| --- | --- | --- |
| Launch R$ 99/mês, Growth R$ 197/mês (cards, landing preview, pricing meta description) | `PLAN_OFFERS` in `src/lib/plans.ts`, formatted by `formatPlanPrice` (`src/lib/plans-display.ts`, over `src/lib/money.ts`); the meta description receives the formatted prices as ICU arguments; the Stripe Prices behind `STRIPE_LAUNCH_PRICE_ID` / `STRIPE_GROWTH_PRICE_ID` must match (README, Platform billing) | DERIVED |
| "Preços em reais (BRL)" in both locales | `PlanOffer.currency: "BRL"` | TRUE |
| Only Launch and Growth are sold; Scale is not shown | `PUBLIC_PAID_PLANS` filters `public && purchasable`; `PLAN_OFFERS.scale.public === false` | DERIVED |
| Growth marked "Recomendado" | `PLAN_OFFERS.growth.recommended` | DERIVED |
| Sandbox: grátis, sem prazo, 1 programa de teste, até 10 afiliados, 1 pessoa | `PLAN_CAPABILITIES.sandbox`; no row in `workspace_subscriptions` = Sandbox with no expiry (`src/server/domain/entitlements.ts`) | DERIVED |
| Sandbox is test data only | `features.liveMode: false`; live clicks ignored, live identify → `LIVE_MODE_REQUIRED`, live Stripe events not claimed (`src/server/services/tracking.ts`, `identify.ts`, `billing-events.ts`) | TRUE |
| Sandbox: conversões simuladas | `src/server/services/sandbox.ts` (click → identify → payment through the real services, test programs only), `src/features/sandbox/simulate-conversion-dialog.tsx`, `sandbox.db.test.ts` | TRUE |
| Sandbox: modo de teste do Stripe | test/live signing secrets per integration, routing by `livemode` (`src/app/api/webhooks/stripe/[integrationId]/route.ts`) | TRUE |
| Launch: 1 programa em produção, 1 de teste, até 100 afiliados, até 2 pessoas | `PLAN_CAPABILITIES.launch.limits`, enforced by `assertWithinLimit` (`src/server/services/entitlements.ts`) in programs, affiliates and invites services | DERIVED |
| Launch: modo produção, comissões sobre pagamentos reais | `features.liveMode: true`, `assertLiveMode` | DERIVED |
| Growth: programas (produção e teste) e afiliados ilimitados, até 10 pessoas | `PLAN_CAPABILITIES.growth.limits` (`null` = unlimited) | DERIVED |
| Growth: taxa própria por afiliado | `assertFeature(…, "customAffiliateRates")` in `src/server/services/affiliates.ts` | DERIVED |
| Growth: registro de auditoria | `assertFeature(…, "auditLog")` in `src/server/services/audit.ts`; screen `src/features/plans/audit-log-panel.tsx` | DERIVED |
| Three comparable cards (Sandbox, Launch, Growth): mode, every limit, and only the features a plan has — nothing struck through | `cardLines()` / `PRICING_CARDS` in `src/lib/plans-display.ts`, tested in `plans-display.test.ts` | DERIVED |

## Core, listed once under the cards ("Incluído em todos os planos") and true on every plan

| Public claim | Evidence | Verdict |
| --- | --- | --- |
| Script de rastreamento e links de indicação | `src/app/t.js/route.ts`, `src/app/api/track/route.ts`, `src/server/services/tracking.ts`; links in the portal `src/app/[locale]/(affiliate)/affiliate/links/` | TRUE |
| Atribuição por primeiro ou último clique, com janela | `src/server/domain/attribution.ts`; `programs.attribution_window_days` | TRUE |
| API de identificação de clientes | `src/app/api/identify/route.ts`, `src/server/services/identify.ts` | TRUE |
| Integração com Stripe, endpoints de teste e produção | `src/app/api/webhooks/stripe/[integrationId]/route.ts`, `src/lib/billing/stripe/`, `src/features/integrations/stripe-panel.tsx` | TRUE |
| Comissões percentuais, fixas e recorrentes, com retenção | `src/server/domain/commission.ts` | TRUE |
| Estornos e disputas viram reversões | `src/server/services/billing-events.ts` (reversal rows, never deletes) | TRUE |
| Portal do afiliado | `src/app/[locale]/(affiliate)/affiliate/*`, `src/server/services/portal.ts` | TRUE |
| Lotes de pagamento com exportação em CSV | `src/server/services/payouts.ts`, `src/features/payouts/csv.ts` | TRUE |
| Receita, comissões, cliques, clientes e taxa de conversão | `src/server/repositories/analytics.ts` | TRUE |

## Billing ("Como funciona a cobrança", start note)

| Public claim | Evidence | Verdict |
| --- | --- | --- |
| "Você começa no Sandbox, sem cartão" | new workspaces have no subscription row; no card is collected before Checkout (`src/server/services/platform-billing.ts`) | TRUE |
| Sem trial pago | Checkout session in subscription mode with no trial (`platform-billing.ts`, `src/lib/platform-billing/stripe/gateway.ts`) | TRUE |
| Ativação em Configurações → Plano e cobrança, pelo Stripe Checkout | `src/features/plans/`, `platform-billing.ts` | TRUE |
| Cobrança mensal pelo Stripe | monthly BRL Prices (README, Platform billing) | TRUE |
| Troca de plano, cartão, faturas e cancelamento no portal do Stripe | `billingPortal.sessions.create` in `gateway.ts`; portal configured for end-of-period cancellation (README) | TRUE |
| Cancelamento vale até o fim do período; o workspace volta ao Sandbox sem apagar dados | `cancelAtPeriodEnd` handling in `resolveEntitlements` (`src/server/domain/entitlements.ts`); downgrade deletes nothing (docs/PLANS.md §6) | TRUE |
| Pagamento atrasado: 7 dias de tolerância; depois produção e criação pausam, dados continuam acessíveis | `PAST_DUE_GRACE_DAYS` (the page reads the constant), `restricted` standing in `entitlements.ts`, `SUBSCRIPTION_REQUIRED` | TRUE |
| "Cancele quando quiser" | Billing Portal cancellation | TRUE |

## Landing narrative

| Public claim | Evidence | Verdict |
| --- | --- | --- |
| "Comece sem cartão de crédito" (hero, closing, OG image) | as above; was "Sem cartão de crédito", which read as "never needs a card" | REWORDED |
| "Sem taxa sobre a sua receita" / "Você paga pela ferramenta" | no transfers or revenue share anywhere; plans are flat monthly prices | TRUE |
| "Integra com Stripe" | Stripe adapter | TRUE |
| "Conversão registrada · comissão em retenção" (hero visual) | the event as the dashboard shows it; no notification is implied | TRUE |
| Flow: clique → cadastro identificado pelo seu backend → Stripe confirma → regra calcula | tracking, identify, billing-events, commission engine | TRUE |
| Problema: rastreamento, atribuição, webhooks sem comissão duplicada, recorrência, estornos, conciliação | `webhook_events` idempotency, commission engine, reversals, payouts | TRUE |
| "Nada exige migração, contrato ou mudança no seu checkout" | reads Stripe events; monthly plan cancellable in the portal | TRUE |
| Conecte a cobrança: endpoint por workspace, segredo de assinatura, "primeiro no modo de teste do Stripe, depois no de produção", nunca a chave secreta | per-integration encrypted test and live signing secrets | REWORDED (test/live added) |
| "No Growth, seu melhor parceiro pode ter uma taxa própria" | custom rates are a Growth feature | REWORDED (was stated for every plan) |
| Convide afiliados: convite por e-mail ou link copiável, portal próprio | `src/server/services/invite-mail.ts`, `src/features/affiliates/invite-affiliate-dialog.tsx` | TRUE |
| Conversões e comissões aparecem sozinhas; estornos viram reversões | Stripe webhooks → `billing-events.ts` | TRUE |
| Atribuição com janela; caminho de cada conversão do clique à comissão | `src/app/[locale]/(dashboard)/[workspaceSlug]/conversions/[conversionId]/page.tsx` | TRUE |
| Retenção, lote, "paga do seu jeito", marca como pago | `payouts.ts`; IndicaFluxo never moves money | TRUE |
| Dois lados: desempenho por afiliado, comissões por status, lotes; portal com ganhos, links, histórico de pagamentos | affiliate detail page, commissions filters, `(affiliate)/affiliate/payouts` | TRUE |
| Integrações: Stripe (disponível), script de rastreamento, API de identificação; "Hoje a cobrança integrada é o Stripe." | the only billing adapter is `src/lib/billing/stripe/` | TRUE |
| E-mails de clientes guardados como hash | `customers.email_hash` (`src/server/db/schema/billing.ts`) | TRUE |
| Cada comissão guarda a regra; correções viram novos registros | `commissions.rule_applied`; reversal rows | TRUE |
| Preview de preços: Sandbox + Launch + Growth | same `plans-display.ts` config and `pricing.*` messages as the pricing page | DERIVED |
| "Comece grátis no Sandbox. Pague quando for para produção." | liveMode requires Launch/Growth | REWORDED |

## Auth proof card

`src/features/auth/auth-proof.tsx` shows one referral traced from click to
commission for a founder's customer on a "Pro" plan — the founder's product,
not an IndicaFluxo plan. It states no IndicaFluxo price, limit or feature.
Unchanged, TRUE.

## Removed

- **"Starter" plan, "Sob pedido", "combinamos o pagamento com você", "Nada é
  cobrado automaticamente"** — replaced by Sandbox → Launch/Growth through
  Stripe Checkout.
- **"O que acontece depois" (criar conta → pedir o Growth → a gente entra em
  contato)** — replaced by "Como funciona a cobrança".
- **Per-locale prices (`PRICE_MINOR`, US$ 49 in English)** — prices are BRL in
  every locale, from `PLAN_OFFERS`.
- **Struck-through "not included" lines** on plan cards — a card lists only
  what its plan has.
- **Old plan line wording** ("Convites para o time" as a Growth feature, "Só
  você no workspace" on the free plan as a sales line) — members are a limit on
  every plan, rendered from `PLAN_CAPABILITIES`.
- **"Outros provedores de cobrança estão a caminho"** — removed earlier; not
  reintroduced.
- **"Mais popular"** — not used: nothing in the product measures popularity.
  The badge reads "Recomendado", backed by `PLAN_OFFERS.growth.recommended`.

Never promised anywhere on these pages (not implemented): branding or white
label, custom domain, outgoing webhooks, an API beyond track/identify, SLA or
priority support, notifications, billing providers other than Stripe.

## Still open (stated, not hidden)

- Refunds after a commission was **paid** are recorded as reversals but not
  clawed back from a later payout.
- Pausing or archiving a program stops new attributions, not commissions for
  customers already attributed — the program form's confirmation says exactly
  that.
