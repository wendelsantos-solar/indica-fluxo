import type {
  ConversionTrailData,
  TrailClick,
  TrailCommission,
  TrailTransaction,
} from "@/server/repositories/conversion-trail"

/**
 * A conversion's path as an ordered list of events — the view model behind
 * `/[workspaceSlug]/conversions/[conversionId]`. Pure (no I/O, no React), so
 * the ordering and the first/last click rules are unit-tested.
 *
 * Order: first click → last click → customer identified → then the money, by
 * the date it moved. A commission sits right after the payment it was computed
 * from and a reversal right after its refund, whatever time the rows were
 * written: a backfilled commission is still about its payment's day.
 */

export type TrailEvent =
  | {
      kind: "click"
      /** `first` also when it is the only click; `last` only when it differs from the first. */
      role: "first" | "last"
      at: Date
      click: TrailClick
      /** The click came through another affiliate than the one credited. */
      otherAffiliate: boolean
    }
  | {
      kind: "identified"
      /** The identify call's time is not stored; the event is placed, not dated. */
      at: null
      externalId: string | null
      providerCustomerId: string | null
    }
  | { kind: "transaction"; at: Date; transaction: TrailTransaction; highlighted: boolean }
  | { kind: "commission"; at: Date; commission: TrailCommission; highlighted: boolean }
  | {
      kind: "reversal"
      at: Date
      commission: TrailCommission
      /** The refund or dispute it undoes, when loaded. */
      transaction: TrailTransaction | null
      highlighted: boolean
    }

/**
 * - `matched` — the attribution credits the commission's affiliate.
 * - `moved` — found, but it credits someone else now (a later click, under
 *   last click, rewrote the row after the conversion).
 * - `missing` — none: a manual conversion, an identify call with another id, or
 *   a customer matched without one.
 */
export type AttributionState = "matched" | "moved" | "missing"

export interface ConversionTrail {
  events: TrailEvent[]
  attributionState: AttributionState
}

export type TrailInput = Pick<
  ConversionTrailData,
  "conversionId" | "affiliate" | "customer" | "attribution" | "clicks" | "transactions" | "commissions"
>

const RANK: Record<TrailEvent["kind"], number> = {
  click: 0,
  identified: 1,
  transaction: 2,
  commission: 3,
  reversal: 4,
}

interface Sortable {
  event: TrailEvent
  time: number
  /** Tie-breaks events at the same instant: a click's role, then the kind. */
  rank: number
  id: string
}

/** The first click and the last one, the latter only when it is a different click. */
export function trailClicks(
  attribution: TrailInput["attribution"],
  clicks: readonly TrailClick[],
): { first: TrailClick | null; last: TrailClick | null } {
  if (!attribution) return { first: null, last: null }
  const byId = new Map(clicks.map((click) => [click.id, click]))
  const first = attribution.firstClickId ? (byId.get(attribution.firstClickId) ?? null) : null
  const lastCandidate = attribution.lastClickId ? (byId.get(attribution.lastClickId) ?? null) : null

  // Only one of them survived (a click row may be gone): it is shown once, as
  // the first click — there is nothing to compare it with.
  if (!first) return { first: lastCandidate, last: null }
  if (!lastCandidate || lastCandidate.id === first.id) return { first, last: null }
  return { first, last: lastCandidate }
}

export function buildConversionTrail(input: TrailInput): ConversionTrail {
  const participationId = input.affiliate.participationId
  const attributionState: AttributionState = !input.attribution
    ? "missing"
    : input.attribution.participationId === participationId
      ? "matched"
      : "moved"

  const items: Sortable[] = []

  const { first, last } = trailClicks(input.attribution, input.clicks)
  for (const [role, click] of [
    ["first", first],
    ["last", last],
  ] as const) {
    if (!click) continue
    items.push({
      event: {
        kind: "click",
        role,
        at: click.occurredAt,
        click,
        otherAffiliate: click.participationId !== participationId,
      },
      time: click.occurredAt.getTime(),
      rank: role === "first" ? 0 : 1,
      id: click.id,
    })
  }

  const transactions = new Map(input.transactions.map((transaction) => [transaction.id, transaction]))
  const moneyAnchor = (commission: TrailCommission) =>
    (transactions.get(commission.transactionId)?.occurredAt ?? commission.createdAt).getTime()

  const externalId = input.attribution?.customerExternalId ?? input.customer.externalId
  const providerCustomerId = input.attribution?.providerCustomerId ?? input.customer.providerCustomerId
  if (externalId) {
    // Undated: after the clicks that led to it, and before any money — a click
    // recorded after the first payment (first click keeps tracking the last
    // one) does not push it past that payment.
    const latestClick = Math.max(
      Number.NEGATIVE_INFINITY,
      ...[first, last].filter((click): click is TrailClick => click !== null).map((click) => click.occurredAt.getTime()),
    )
    const firstMoney = Math.min(
      Number.POSITIVE_INFINITY,
      ...input.transactions.map((transaction) => transaction.occurredAt.getTime()),
      ...input.commissions.map(moneyAnchor),
    )
    items.push({
      event: { kind: "identified", at: null, externalId, providerCustomerId },
      time: Math.min(latestClick, firstMoney),
      rank: 10 + RANK.identified,
      id: "identified",
    })
  }

  const opened = input.commissions.find((commission) => commission.id === input.conversionId)

  for (const transaction of input.transactions) {
    items.push({
      event: {
        kind: "transaction",
        at: transaction.occurredAt,
        transaction,
        highlighted: transaction.id === opened?.transactionId,
      },
      time: transaction.occurredAt.getTime(),
      rank: 10 + RANK.transaction,
      id: transaction.id,
    })
  }

  for (const commission of input.commissions) {
    const transaction = transactions.get(commission.transactionId) ?? null
    const highlighted = commission.id === input.conversionId
    items.push({
      event: commission.reversalOfCommissionId
        ? { kind: "reversal", at: commission.reversedAt ?? commission.createdAt, commission, transaction, highlighted }
        : { kind: "commission", at: commission.createdAt, commission, highlighted },
      time: moneyAnchor(commission),
      rank: 10 + (commission.reversalOfCommissionId ? RANK.reversal : RANK.commission),
      id: commission.id,
    })
  }

  items.sort((a, b) => a.time - b.time || a.rank - b.rank || a.id.localeCompare(b.id))

  return { events: items.map((item) => item.event), attributionState }
}

/**
 * Where on the product the visitor landed: path and query of the landing URL,
 * or the stored text as is when it is not a URL.
 */
export function landingPath(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}
