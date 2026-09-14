import type {
  AttributionFacts,
  ParticipationRules,
  ProgramRules,
  TransactionFacts,
  TransactionType,
} from "../types"

export const AT = (iso: string) => new Date(iso)

export function program(overrides: Partial<ProgramRules> = {}): ProgramRules {
  return {
    id: "prog_1",
    workspaceId: "ws_1",
    currency: "USD",
    commissionType: "percentage",
    commissionValue: 3000, // 30%
    commissionDurationMonths: 12,
    attributionModel: "last_click",
    attributionWindowDays: 60,
    commissionHoldDays: 14,
    ...overrides,
  }
}

export function participation(
  overrides: Partial<ParticipationRules> = {},
): ParticipationRules {
  return {
    id: "pa_1",
    programId: "prog_1",
    affiliateId: "aff_1",
    status: "approved",
    customCommissionType: null,
    customCommissionValue: null,
    ...overrides,
  }
}

export function transaction(
  overrides: Partial<TransactionFacts> & { type?: TransactionType } = {},
): TransactionFacts {
  return {
    id: "trx_1",
    type: "payment",
    currency: "USD",
    grossAmountMinor: 4900, // $49.00
    occurredAt: AT("2026-09-01T10:00:00Z"),
    ...overrides,
  }
}

export function attribution(overrides: Partial<AttributionFacts> = {}): AttributionFacts {
  return {
    id: "attr_1",
    programAffiliateId: "pa_1",
    attributedAt: AT("2026-08-20T10:00:00Z"),
    expiresAt: AT("2026-10-19T10:00:00Z"),
    firstCommissionedAt: null,
    ...overrides,
  }
}
