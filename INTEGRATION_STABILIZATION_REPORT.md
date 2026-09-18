# INTEGRATION_STABILIZATION_REPORT.md

Stabilization round after the multi-provider phase. No new architecture,
provider, redesign or feature; no migration; no public status or SEO change.
Date: 2026-09-18.

## STRIPE_INCOMPLETE_SETUP

**Cause.** `startStripeIntegration` (step 1 of the manual path) creates the row
`status = 'disconnected'` with the account id, so the webhook URL can exist
before the secret. The Integrations page dropped every `disconnected` row, so a
founder who left after step 1 lost the setup from every list.

**Fix — derived, no migration.** A real disconnect always stamps
`disconnected_at`; a setup never finished never has it. One pure function,
`connectionPresence()` (`src/features/integrations/health.ts`):

| Row | Presence | Shown as |
| --- | --- | --- |
| `disconnected`, no `disconnected_at`, no credential, not OAuth | `setupIncomplete` | **Configuração incompleta** (warning) · "Falta concluir a configuração manual." · *Continuar configuração* |
| `disconnected` with `disconnected_at` | `hidden` | — (real disconnect; history kept) |
| API-key row whose key was never stored | `hidden` | — (failed or interrupted attempt, nothing to resume) |
| everything else | `visible` | existing states |

`Configuração incompleta` already existed as the workspace status; it is now
also a connection badge (`ConnectionDisplayState` + `setupIncomplete`). It is
never *Saudável*, *Aguardando eventos* or *Erro*. No other new visual state.

Where it shows: overview rows, Pagamentos cards ("Stripe — Conta principal ·
Configuração incompleta · Falta concluir a configuração manual. Continuar
configuração"), the setup checklist (step *Conectar Stripe* → "Configuração
iniciada — falta concluir…" + *Continuar configuração*), the summary
(*Status geral* = Configuração incompleta), the connection page badge. The
connection page hides the empty *Saúde* block until the setup is finished, so
the wizard is the first thing below the status line. Docs: one row added to
the status table in *Saúde da integração*.

## RESUME_FLOW

*Continuar configuração* opens the connection page, whose Stripe wizard derives
its step from what is stored (`deriveStripeState` → `awaitingSecret`): account
✓ (shown, editable via *Alterar*, never asked again), **Etapa 2 de 4** — the
endpoint to create and the secret to paste. Secrets are never displayed; only
whether one is saved. Saving the secret turns the row `connected` →
*Aguardando eventos* → *Saudável* with evidence. Verified in the signed-in app
with a row written exactly as step 1 writes it, then deleted.

## DUPLICATE_PROTECTION

- Same workspace + Stripe + account id (+ environment `null`, Stripe spans both
  modes): `startStripeIntegration` upserts on the existing unique index — the
  same row is resumed, never a second one. After a **real disconnect**, starting
  the same account again resumes that row as an unfinished setup
  (`disconnected_at` reset to null) instead of hiding it.
- The connect dialog shows *Configuração em andamento* with *Continuar
  configuração* for every unfinished setup of that provider before offering a
  new one.
- A different account id is a new connection (multi-account unchanged).
- API-key providers keep their fingerprint duplicate check (`billing_duplicate`).

## OTHER_PROVIDER_PARTIAL_STATES

| Provider | Partial state | Behaviour |
| --- | --- | --- |
| Mercado Pago | token valid, panel step left (`pending`, token stored) | Visible, **Configurando**, steps 1-2-3 (unchanged). "Já configurei — verificar" stores the secret; the connection is *Aguardando eventos* until a verified notification — **no false positive** (new DB test). The toast no longer says "Eventos ativados": "Assinatura salva. A conta só fica Saudável quando chegar a primeira notificação verificada." |
| AbacatePay / Asaas | key refused, or webhook registration refused, on a first connect | Row deleted (existing); no ghost (test asserts zero rows) |
| AbacatePay / Asaas | process interrupted between the placeholder insert and the provider's answer | `pending`, no key stored → **hidden** (nothing to resume; the founder pastes the key again). Row stays in the DB, harmless |
| Any | key rotation refused on an existing connection | Existing row untouched (existing) |
| Stripe OAuth | only created on a successful callback | Nothing partial |

## TESTS

| Suite | Result |
| --- | --- |
| `RUN_DB_TESTS=1 vitest run` | **731 passed**, 3 skipped, 69 files (was 717) |
| `pnpm test` (no DB) | 600 passed, 134 skipped |
| lint · typecheck · build | pass |

New:
- DB: "a manual Stripe setup left halfway stays visible, resumes where it
  stopped, completes and never duplicates" — visible as `setupIncomplete`;
  resumes at `awaitingSecret` with the account kept; same account → same row;
  other account → second row (multi-account); secret → `awaitingEvents`; real
  disconnect → hidden; restart → same row, unfinished again.
- DB: "Mercado Pago: saving the panel secret is not a false positive".
- DB (strengthened): refused key leaves **no** row at all.
- Unit: `connectionPresence` (5 cases), `deriveSetup` incomplete step with the
  connection to resume and no auto-refresh.
- Unit: maturity gate (`src/lib/billing/__tests__/validation.test.ts`, 6).
- Existing disconnect and multi-account DB tests unchanged and passing.

## PRODUCTION_VALIDATION_STATUS

Infrastructure: `src/lib/billing/validation.ts` — 21-item typed evidence ledger
per beta provider, maturity model (`coming_soon` · `beta_implemented` ·
`beta_real_tested` · `stable`), `maturityGate()`; `CONNECTORS[*].maturity` in
the catalog. CI now fails if a connector is `public` without `stable`, `stable`
without a complete ledger, a PASS lacks date/environment/evidence, an N/A lacks
a reason, a secret-shaped value enters the ledger, or the human checklist
(`PROVIDER_PRODUCTION_VALIDATION.md`) misses an item.

| Provider | Maturity | Real validation |
| --- | --- | --- |
| Mercado Pago | `beta_implemented` | NOT_STARTED |
| AbacatePay | `beta_implemented` | NOT_STARTED (partial refund pre-marked N/A with source) |
| Asaas | `beta_implemented` | NOT_STARTED |
| Stripe OAuth | `stable` (Stripe) | NOT_STARTED — no platform Connect client in dev (`STRIPE_CONNECT_CLIENT_ID` empty) and it needs the account owner to authorize on Stripe |

No real round trip was run in this round: it needs merchant/sandbox
credentials and, for OAuth, the owner's authorization on Stripe — neither is
available to the agent, and credentials must not be entered by it. Nothing is
marked PASS.

## KNOWN_LIMITATIONS

1. Real-account validation of the three beta providers and of Stripe OAuth is
   still to be run (checklist and evidence format ready).
2. An interrupted API-key attempt leaves a hidden `pending` row without a key
   (never shown, never matched by webhooks — the route needs stored
   credentials). No cleanup job was added.
3. The resume notice in the connect dialog labels an unnamed setup "Stripe";
   with several unnamed unfinished setups the labels repeat (account ids are
   deliberately not shown in founder UI).
4. VoiceOver was not run (the agent cannot drive it); accessibility stays
   PARTIAL — keyboard, focus, dialogs and `details` were checked earlier.
