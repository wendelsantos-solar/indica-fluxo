# Landing claims audit

Every benefit the public pages (landing `/`, pricing `/precos`, auth proof card)
state was checked against the code. For each claim: what the code did, and what
changed — the feature was built when it belongs in the product, the copy was
changed when it did not.

Verdicts: **TRUE** — already held · **BUILT** — made true in this pass ·
**COPY** — wording changed to match the product · **OPEN** — a known limit that
the copy no longer hides.

## Hero and trust line

| Claim | Before | Verdict | Now |
| --- | --- | --- | --- |
| "Sem cartão de crédito" | No card is ever collected | TRUE | — |
| "Sem taxa sobre a sua receita" | No transfers, fees or checkout in the code | TRUE | — |
| "Integra com Stripe" | Webhooks verified with one platform-wide secret; a founder's own endpoint could never verify (T1) | BUILT | Each workspace gets its own endpoint `/api/webhooks/stripe/<integrationId>` and pastes its signing secret, stored encrypted. Integrations only shows "Recebendo eventos" after a real event arrives |
| Floating "Nova conversão" card | Implied a notification; no notification system exists | COPY | "Conversão registrada · comissão em retenção" — the event as it appears in the dashboard. It also no longer spills into the next section |

## Problem / how it works

| Claim | Before | Verdict | Now |
| --- | --- | --- | --- |
| Tracking de cliques e cookies | Tracker + `_referral_id` cookie | TRUE | "Rastreamento" |
| Atribuição quando dois afiliados indicam o mesmo cliente | First/last click per program, configurable window | TRUE | The attribution row now also refreshes the model that decided it |
| Webhooks do Stripe sem comissão duplicada | `webhook_events` idempotency | TRUE | — |
| Comissão recorrente | 1 = first payment, N months, null = forever | TRUE | — |
| Estornos que revertem comissões | Refunds on subscription invoices and every dispute failed to find the payment; a second partial refund was dropped; a partial refund reversed the whole commission; a suspended affiliate's refunds were never reversed (T6) | BUILT | `transaction_references` maps `in_`/`pi_`/`ch_` to the stored payment; `refund.created` / `dp_…` ids; proportional integer reversals; reversal decided before the participation gate |
| "Conecte a cobrança … nunca guardamos sua chave secreta" | True for the API key, but the flow could not work | COPY + BUILT | "Cadastre o endereço de webhook que geramos … cole o segredo de assinatura. Nunca pedimos a chave secreta da sua API." |
| "Convide afiliados — cada afiliado recebe um link" | Invites only inserted rows; nothing was sent and the founder had no link | BUILT | Supabase invitation e-mail + a copyable link always shown; existing accounts are claimed at sign-in (migration 0008) |
| Taxa especial por afiliado | Custom rate per participation | TRUE | Growth feature, enforced |

## Product

| Claim | Before | Verdict | Now |
| --- | --- | --- | --- |
| "A decisão fica registrada" | Only the winner was stored; no screen showed why | BUILT + COPY | Conversion detail page with the trail (first/last click, identification, payments, commissions with the rule applied, reversals) and the attribution model/window. Copy: "você vê o caminho de cada conversão, do clique à comissão" |
| "Um estorno cria uma reversão em vez de apagar o histórico" | Reversal rows existed, but matching failed (above) | BUILT | — |
| "Comissões cumprem a carência … lote … marca como pago" | Hold, batches, mark paid | TRUE | "período de retenção" (one term product-wide); batch CSV export and copy-as-table added |

## Two sides

| Claim | Before | Verdict | Now |
| --- | --- | --- | --- |
| Desempenho de cada parceiro | Names were not links; no per-affiliate view | BUILT | Affiliate detail page; Conversions/Commissions filter by affiliate |
| Comissões por status | Status filter | TRUE | Sorting, occurrence date, "Em lote" wording |
| Portal: ganhos a receber e já pagos | One "A receber" number | BUILT | Disponível / Em retenção (next release date) / Em lote |
| Links de indicação prontos para copiar | Yes; named links could not be edited | TRUE + BUILT | Rename and delete named links |

## Integrations and principles

| Claim | Before | Verdict | Now |
| --- | --- | --- | --- |
| "Outros provedores de cobrança estão a caminho" | A roadmap promise | COPY | "Hoje a cobrança integrada é o Stripe." |
| E-mails de clientes guardados como hash | `customers.email_hash` only | TRUE | The hash now also matches Stripe payments when `providerCustomerId` was never sent (T3) |
| "Cada comissão guarda a regra que a gerou" | `rule_applied` stored but shown nowhere | BUILT | Shown in Commissions and on the conversion trail |
| "Não tocamos no dinheiro" | Stripe is read-only | TRUE | — |

## Pricing

| Claim | Before | Verdict | Now |
| --- | --- | --- | --- |
| Three plans with limits, "Suporte prioritário", "Retenção de dados estendida", "Múltiplos workspaces", "Mais popular" | No plan, limit or billing existed | BUILT + COPY | Two plans. `workspaces.plan` (column grant prevents self-upgrade); Starter limits enforced (1 program, 10 affiliates, 1 member; no custom rates, team invites or audit log); usage and upgrade request in Settings; the audit log is a real Growth screen. Feature lists render from `src/lib/plans.ts`. Unbacked features and "Mais popular" removed; "Sem cobrança automática — combinamos o pagamento com você" |

## Still open (stated, not hidden)

- Refunds after a commission was **paid** are recorded as reversals but not
  clawed back from a later payout.
- A `payment_intent.succeeded` processed before `invoice_payment.paid` links it
  to its invoice can still double count (logged).
- Pausing or archiving a program stops new attributions, not commissions for
  customers already attributed — the program form's confirmation says exactly
  that.
