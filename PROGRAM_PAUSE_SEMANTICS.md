# PROGRAM_PAUSE_SEMANTICS.md

What pausing (or archiving) a program does to attribution and commissions.
Status: **CONFIRMED** — the code, the affiliate portal copy and a DB test agree,
so it is documented as an official rule. Date: 2026-09-18.

## CURRENT_BEHAVIOR

| Moment | Behaviour | Code |
| --- | --- | --- |
| Click while paused / draft / archived | Recorded for reporting; **no attribution created or changed** | `src/server/services/tracking.ts` — `trackable = programStatus === "active" && participationStatus === "approved"` |
| Signup (identify) while paused, for a click made **before** the pause | The open attribution (window not expired) **is bound** to the customer | `src/server/services/identify.ts` — binds by visitor, filters programs by workspace + environment only |
| Payment of an already-attributed customer while paused | **Commission created** under the program's other rules (window for the first payment, duration, approved participation, currency, environment) | `src/server/services/commission-writer.ts` / `src/server/domain/commission.ts` — no program-status gate; `PROGRAM_INACTIVE` is never emitted |

Pinned by `multi-provider.db.test.ts` — "a paused program keeps paying
already-attributed customers, and a pre-pause referral still binds at signup".

The affiliate portal already promised this before this document
(`affiliatePortal…programStatus.paused/archived`: "Clientes que você já indicou
continuam gerando comissão normalmente").

## OPTIONS

1. **Keep** (current): pause stops new attributions only.
2. Pause also stops commissions for existing customers.
3. Pause also stops binding pre-pause referrals at signup.

## IMPACT

- Option 2 would silently stop paying affiliates for customers they already
  brought — the opposite of what the affiliate portal promises, and a trust
  problem for a commission ledger.
- Option 3 would make the result depend on *when* the visitor signed up rather
  than when they were referred.

## RECOMMENDATION

Keep option 1 and document it (done): guide → Conceitos → Atribuição →
*Programa pausado*; Customer-first rules; "Pagamento sem comissão" reasons.
Official copy:

> Pausar um programa interrompe novas atribuições. Clientes já atribuídos
> continuam seguindo as regras de comissão existentes até o fim da elegibilidade.

To end commissions for a program, the founder ends the participations (the
affiliate stops being *approved*), which the engine already gates on.
