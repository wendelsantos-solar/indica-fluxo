/**
 * Domain types. Deliberately free of Drizzle, Stripe, React and HTTP so that
 * the money-critical logic below can be unit-tested without any I/O.
 */

export type CommissionType = "percentage" | "fixed"
export type AttributionModel = "first_click" | "last_click"

export interface ProgramRules {
  id: string
  workspaceId: string
  currency: string
  commissionType: CommissionType
  /** Basis points when percentage, minor units when fixed. */
  commissionValue: number
  /** null = lifetime, 1 = first payment only, n = n months from first payment. */
  commissionDurationMonths: number | null
  attributionModel: AttributionModel
  attributionWindowDays: number
  commissionHoldDays: number
}

export interface ParticipationRules {
  id: string
  programId: string
  affiliateId: string
  status: "pending" | "approved" | "rejected" | "suspended"
  customCommissionType: CommissionType | null
  customCommissionValue: number | null
}

export type TransactionType = "payment" | "refund" | "chargeback" | "adjustment"

export interface TransactionFacts {
  id: string
  type: TransactionType
  currency: string
  grossAmountMinor: number
  occurredAt: Date
}

export interface AttributionFacts {
  id: string
  programAffiliateId: string
  attributedAt: Date
  expiresAt: Date
  /** When the first commissionable payment happened, if any. */
  firstCommissionedAt: Date | null
}
