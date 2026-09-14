import { addDays, addMonths } from "@/lib/utils"
import { applyBasisPoints } from "@/lib/money"

import { isAttributionValidAt } from "./attribution"
import type {
  AttributionFacts,
  CommissionType,
  ParticipationRules,
  ProgramRules,
  TransactionFacts,
} from "./types"

/**
 * The commission engine. Pure: no database, no HTTP, no ambient clock.
 * Everything it needs is an argument, which is why every branch below is
 * exhaustively unit-tested in ./__tests__/commission.test.ts.
 */

export interface CommissionInput {
  program: ProgramRules
  participation: ParticipationRules
  transaction: TransactionFacts
  attribution: AttributionFacts
  /** The commission being reversed, when handling a refund or chargeback. */
  originalCommission?: {
    id: string
    commissionAmountMinor: number
    baseAmountMinor: number
    currency: string
  } | null
  now: Date
}

export interface CommissionOutcome {
  kind: "commission" | "reversal"
  currency: string
  baseAmountMinor: number
  /** Basis points; null for fixed-amount rules. */
  commissionRate: number | null
  /** Signed. Negative for a reversal. */
  commissionAmountMinor: number
  eligibleAt: Date
  ruleApplied: string
  reversalOfCommissionId?: string
}

export interface CommissionSkipped {
  kind: "skipped"
  reason: SkipReason
  detail: string
}

export type SkipReason =
  | "participation_not_approved"
  | "attribution_expired"
  | "recurrence_window_closed"
  | "currency_mismatch"
  | "non_commissionable_transaction"
  | "zero_amount"
  | "no_original_commission"

export type CommissionResult = CommissionOutcome | CommissionSkipped

function skip(reason: SkipReason, detail: string): CommissionSkipped {
  return { kind: "skipped", reason, detail }
}

interface ResolvedRate {
  type: CommissionType
  value: number
  source: "affiliate_override" | "program"
}

/** Affiliate override beats the program rule. That is the whole VIP feature. */
export function resolveRate(
  program: ProgramRules,
  participation: ParticipationRules,
): ResolvedRate {
  if (participation.customCommissionType !== null && participation.customCommissionValue !== null) {
    return {
      type: participation.customCommissionType,
      value: participation.customCommissionValue,
      source: "affiliate_override",
    }
  }
  return { type: program.commissionType, value: program.commissionValue, source: "program" }
}

/**
 * `commissionDurationMonths`:
 *   null → lifetime
 *   1    → first payment only
 *   n    → payments within n months of the first commissioned payment
 */
export function isWithinRecurrenceWindow(
  program: ProgramRules,
  attribution: AttributionFacts,
  transactionAt: Date,
): boolean {
  const duration = program.commissionDurationMonths
  if (duration === null) return true

  const anchor = attribution.firstCommissionedAt
  if (!anchor) return true // this *is* the first payment

  if (duration === 1) return false // first payment only, and it already happened

  return transactionAt.getTime() < addMonths(anchor, duration).getTime()
}

export function computeAmount(
  rate: ResolvedRate,
  baseAmountMinor: number,
): { amountMinor: number; rateBps: number | null } {
  if (rate.type === "percentage") {
    return { amountMinor: applyBasisPoints(baseAmountMinor, rate.value), rateBps: rate.value }
  }
  return { amountMinor: rate.value, rateBps: null }
}

export function calculateCommission(input: CommissionInput): CommissionResult {
  const { program, participation, transaction, attribution } = input

  if (participation.status !== "approved") {
    return skip("participation_not_approved", `participation is ${participation.status}`)
  }

  if (transaction.currency.toUpperCase() !== program.currency.toUpperCase()) {
    return skip(
      "currency_mismatch",
      `transaction is ${transaction.currency}, program pays in ${program.currency}`,
    )
  }

  if (transaction.type === "refund" || transaction.type === "chargeback") {
    return calculateReversal(input)
  }

  if (transaction.type !== "payment") {
    return skip("non_commissionable_transaction", `type ${transaction.type} is not commissionable`)
  }

  if (transaction.grossAmountMinor <= 0) {
    return skip("zero_amount", "transaction has no positive gross amount")
  }

  // The attribution window governs click → conversion, not every later renewal.
  // Once the customer has converted and produced a commission, the affiliate is
  // locked to them and `commissionDurationMonths` alone decides how long
  // renewals keep paying. Enforcing the window on every payment would cancel a
  // 12-month program at month three whenever the window is 60 days.
  const isConversion = attribution.firstCommissionedAt === null

  if (isConversion && !isAttributionValidAt(attribution, transaction.occurredAt)) {
    return skip(
      "attribution_expired",
      `attribution expired at ${attribution.expiresAt.toISOString()}`,
    )
  }

  if (!isWithinRecurrenceWindow(program, attribution, transaction.occurredAt)) {
    return skip(
      "recurrence_window_closed",
      program.commissionDurationMonths === 1
        ? "program pays on the first payment only"
        : `commission duration of ${program.commissionDurationMonths} months has elapsed`,
    )
  }

  const rate = resolveRate(program, participation)
  const { amountMinor, rateBps } = computeAmount(rate, transaction.grossAmountMinor)

  if (amountMinor <= 0) {
    return skip("zero_amount", "computed commission rounds to zero")
  }

  return {
    kind: "commission",
    currency: transaction.currency.toUpperCase(),
    baseAmountMinor: transaction.grossAmountMinor,
    commissionRate: rateBps,
    commissionAmountMinor: amountMinor,
    eligibleAt: addDays(transaction.occurredAt, program.commissionHoldDays),
    ruleApplied: describeRule(rate, program),
  }
}

/**
 * A refund never deletes or edits the original row. It produces a negative
 * reversal that references it, so the ledger keeps its history. Partial refunds
 * reverse proportionally to the refunded share of the original base amount.
 */
function calculateReversal(input: CommissionInput): CommissionResult {
  const { transaction, originalCommission, program, now } = input

  if (!originalCommission) {
    return skip("no_original_commission", "nothing to reverse for this transaction")
  }

  const refundedMinor = Math.abs(transaction.grossAmountMinor)
  if (refundedMinor <= 0) return skip("zero_amount", "refund has no amount")

  const originalBase = originalCommission.baseAmountMinor
  const isFull = refundedMinor >= originalBase

  const reversedMinor = isFull
    ? originalCommission.commissionAmountMinor
    : applyBasisPoints(
        originalCommission.commissionAmountMinor,
        Math.round((refundedMinor / originalBase) * 10_000),
      )

  return {
    kind: "reversal",
    currency: originalCommission.currency,
    baseAmountMinor: -refundedMinor,
    commissionRate: null,
    commissionAmountMinor: -Math.abs(reversedMinor),
    // A reversal is immediately final; there is nothing to hold.
    eligibleAt: transaction.occurredAt > now ? transaction.occurredAt : now,
    ruleApplied: isFull
      ? `full ${transaction.type} of ${program.currency} transaction`
      : `partial ${transaction.type}: ${refundedMinor}/${originalBase} of base`,
    reversalOfCommissionId: originalCommission.id,
  }
}

function describeRule(rate: ResolvedRate, program: ProgramRules): string {
  const shape =
    rate.type === "percentage"
      ? `${(rate.value / 100).toFixed(2).replace(/\.00$/, "")}%`
      : `${rate.value} minor units flat`
  const recurrence =
    program.commissionDurationMonths === null
      ? "lifetime"
      : program.commissionDurationMonths === 1
        ? "first payment only"
        : `${program.commissionDurationMonths} months`
  const origin = rate.source === "affiliate_override" ? "affiliate override" : "program rule"
  return `${shape} · ${recurrence} · ${origin}`
}

/** `pending → available` is a pure function of the clock. No worker required. */
export function effectiveCommissionStatus(
  stored: "pending" | "available" | "approved" | "paid" | "reversed" | "rejected",
  eligibleAt: Date,
  now: Date,
): typeof stored {
  if (stored === "pending" && eligibleAt.getTime() <= now.getTime()) return "available"
  return stored
}
