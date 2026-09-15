export const COMMISSION_STATUSES = ["pending", "available", "approved", "paid", "reversed", "rejected"] as const

export type PortalCommissionStatus = (typeof COMMISSION_STATUSES)[number]

export interface CommissionFilterValues {
  status?: PortalCommissionStatus
  programId?: string
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Reads the portal Comissões filters from search params. Only a known status
 * and a program the affiliate actually takes part in survive; anything else —
 * a stale bookmark, a hand-edited URL — is simply no filter.
 */
export function parseCommissionFilters(
  params: Record<string, string | string[] | undefined>,
  programIds: readonly string[],
): CommissionFilterValues {
  const status = first(params.status)
  const program = first(params.program)
  return {
    status: (COMMISSION_STATUSES as readonly string[]).includes(status ?? "")
      ? (status as PortalCommissionStatus)
      : undefined,
    programId: program && programIds.includes(program) ? program : undefined,
  }
}

/** The query a filtered commissions URL carries; empty values are left out. */
export function commissionFilterQuery(
  filters: CommissionFilterValues,
  page?: number,
): Record<string, string> {
  return {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.programId ? { program: filters.programId } : {}),
    ...(page && page > 1 ? { page: String(page) } : {}),
  }
}
