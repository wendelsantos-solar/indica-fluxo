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
    /** Refunded from this payment by earlier refunds/disputes (positive minor units). */
    refundedBeforeMinor?: number
    /** Already reversed from this commission by earlier reversal rows (positive minor units). */
    reversedBeforeMinor?: number
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

  // A refund undoes money already credited, whatever the affiliate's standing
  // is today: suspending an affiliate must not exempt their commissions from
  // the reversal. So reversals are decided before the participation gate, and
  // their currency is checked against the commission they reverse.
  if (transaction.type === "refund" || transaction.type === "chargeback") {
    const currency = input.originalCommission?.currency ?? program.currency
    if (transaction.currency.toUpperCase() !== currency.toUpperCase()) {
      return skip("currency_mismatch", `refund is ${transaction.currency}, commission was ${currency}`)
    }
    return calculateReversal(input)
  }

  if (participation.status !== "approved") {
    return skip("participation_not_approved", `participation is ${participation.status}`)
  }

  if (transaction.currency.toUpperCase() !== program.currency.toUpperCase()) {
    return skip(
      "currency_mismatch",
      `transaction is ${transaction.currency}, program pays in ${program.currency}`,
    )
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
 * `round_half_up(numerator / denominator)` for non-negative integers, exact:
 * BigInt, so `commission × refunded` cannot lose precision past 2^53.
 */
export function proportionHalfUp(amountMinor: number, numerator: number, denominator: number): number {
  if (denominator <= 0) throw new Error("denominator must be positive")
  const a = BigInt(amountMinor)
  const n = BigInt(numerator)
  const d = BigInt(denominator)
  const two = BigInt(2)
  return Number((two * a * n + d) / (two * d))
}

/**
 * A refund never deletes or edits the original row. It produces a negative
 * reversal that references it, so the ledger keeps its history.
 *
 * Partial refunds reverse proportionally, cumulatively: the total reversed
 * after this refund is `round_half_up(commission × refunded so far / base)`,
 * and this row is that total minus what earlier reversals already took. Two
 * partial refunds therefore never over- or under-reverse by a rounding unit,
 * and refunds reaching the full base always reverse exactly the commission.
 */
function calculateReversal(input: CommissionInput): CommissionResult {
  const { transaction, originalCommission, program, now } = input

  if (!originalCommission) {
    return skip("no_original_commission", "nothing to reverse for this transaction")
  }

  const refundedMinor = Math.abs(transaction.grossAmountMinor)
  if (refundedMinor <= 0) return skip("zero_amount", "refund has no amount")

  const originalBase = originalCommission.baseAmountMinor
  const commission = Math.abs(originalCommission.commissionAmountMinor)
  const refundedBefore = Math.max(0, originalCommission.refundedBeforeMinor ?? 0)
  const reversedBefore = Math.max(0, originalCommission.reversedBeforeMinor ?? 0)
  const refundedTotal = refundedBefore + refundedMinor
  const isFull = originalBase <= 0 || refundedTotal >= originalBase

  const targetReversed = isFull ? commission : proportionHalfUp(commission, refundedTotal, originalBase)
  const reversedMinor = Math.min(commission, targetReversed) - reversedBefore

  if (reversedMinor <= 0) {
    return skip("zero_amount", "the commission is already reversed up to this refund")
  }

  return {
    kind: "reversal",
    currency: originalCommission.currency,
    baseAmountMinor: -refundedMinor,
    commissionRate: null,
    commissionAmountMinor: -reversedMinor,
    // A reversal is immediately final; there is nothing to hold.
    eligibleAt: transaction.occurredAt > now ? transaction.occurredAt : now,
    ruleApplied: isFull
      ? refundedBefore > 0
        ? `final ${transaction.type}: ${refundedTotal}/${originalBase} of base refunded`
        : `full ${transaction.type} of ${program.currency} transaction`
      : `partial ${transaction.type}: ${refundedTotal}/${originalBase} of base refunded`,
    reversalOfCommissionId: originalCommission.id,
  }
}

/** Whether refunds so far cover the whole payment the commission was earned on. */
export function isFullyRefunded(baseAmountMinor: number, refundedTotalMinor: number): boolean {
  return baseAmountMinor <= 0 || refundedTotalMinor >= baseAmountMinor
}

export type StoredCommissionStatus = "pending" | "available" | "approved" | "paid" | "reversed" | "rejected"

export interface ReversalPlan {
  /** Status of the new negative row. */
  rowStatus: StoredCommissionStatus
  /** `original`: inherit the original's hold; `now`: payable at once. */
  rowEligibleAt: "original" | "now"
  /** Flip the original to `reversed` (only on a full refund of an unpaid commission). */
  flipOriginal: boolean
  /** Also settle earlier, still-unbatched partial reversal rows to `reversed`. */
  settlePriorReversals: boolean
}

/**
 * Ledger statuses after a refund or dispute. No new status: a partial
 * reversal is a negative row that is payable exactly when the original is, so
 * a payout batch nets the two. Only a full refund of an unpaid commission
 * flips the original — and then its earlier partial rows, which would
 * otherwise subtract from nothing. A `paid` commission is never rewritten: the
 * reversal is recorded, not recovered (no clawback yet).
 */
export function planReversal(original: StoredCommissionStatus, fullyRefunded: boolean): ReversalPlan {
  if (original === "paid" || original === "reversed" || original === "rejected") {
    return { rowStatus: "reversed", rowEligibleAt: "now", flipOriginal: false, settlePriorReversals: false }
  }
  if (fullyRefunded) {
    return { rowStatus: "reversed", rowEligibleAt: "now", flipOriginal: true, settlePriorReversals: true }
  }
  return original === "pending"
    ? { rowStatus: "pending", rowEligibleAt: "original", flipOriginal: false, settlePriorReversals: false }
    : { rowStatus: "available", rowEligibleAt: "now", flipOriginal: false, settlePriorReversals: false }
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
