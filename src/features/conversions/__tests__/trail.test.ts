import { describe, expect, it } from "vitest"

import type {
  TrailAttribution,
  TrailClick,
  TrailCommission,
  TrailTransaction,
} from "@/server/repositories/conversion-trail"

import { buildConversionTrail, landingPath, trailClicks, type TrailInput } from "../trail"

const PARTICIPATION = "pa-joao"

function click(id: string, at: string, participationId = PARTICIPATION): TrailClick {
  return {
    id,
    occurredAt: new Date(at),
    participationId,
    affiliateId: `aff-${participationId}`,
    affiliateName: participationId,
    code: participationId,
    linkCode: null,
    linkName: null,
    landingUrl: "https://produto.com/precos?ref=joao",
    referrerUrl: null,
    utm: { source: null, medium: null, campaign: null, content: null, term: null },
  }
}

function attribution(overrides: Partial<TrailAttribution> = {}): TrailAttribution {
  return {
    id: "attr-1",
    participationId: PARTICIPATION,
    model: "last_click",
    attributedAt: new Date("2026-09-02T10:00:00Z"),
    expiresAt: new Date("2026-11-01T10:00:00Z"),
    customerExternalId: "user_42",
    providerCustomerId: "cus_42",
    firstClickId: "click-1",
    lastClickId: "click-2",
    ...overrides,
  }
}

function transaction(id: string, at: string, type: TrailTransaction["type"] = "payment", amount = 4900): TrailTransaction {
  return {
    id,
    type,
    status: "succeeded",
    currency: "BRL",
    grossAmountMinor: type === "payment" ? amount : -amount,
    occurredAt: new Date(at),
    providerTransactionId: `prov-${id}`,
  }
}

function commission(
  id: string,
  transactionId: string,
  createdAt: string,
  overrides: Partial<TrailCommission> = {},
): TrailCommission {
  return {
    id,
    transactionId,
    currency: "BRL",
    baseAmountMinor: 4900,
    commissionRate: 3000,
    commissionAmountMinor: 1470,
    status: "pending",
    eligibleAt: new Date("2026-10-14T00:00:00Z"),
    createdAt: new Date(createdAt),
    paidAt: null,
    reversedAt: null,
    reversalOfCommissionId: null,
    ruleApplied: "30% · lifetime · program rule",
    batch: null,
    ...overrides,
  }
}

function input(overrides: Partial<TrailInput> = {}): TrailInput {
  return {
    conversionId: "com-1",
    affiliate: { id: "aff-joao", name: "João", participationId: PARTICIPATION, code: "joao" },
    customer: {
      id: "cust-1",
      ref: "user_42",
      externalId: "user_42",
      providerCustomerId: "cus_42",
      createdAt: new Date("2026-09-03T00:00:00Z"),
    },
    attribution: attribution(),
    clicks: [click("click-2", "2026-09-11T10:00:00Z"), click("click-1", "2026-09-02T10:00:00Z")],
    transactions: [transaction("tx-1", "2026-09-14T12:00:00Z")],
    commissions: [commission("com-1", "tx-1", "2026-09-14T12:00:05Z")],
    ...overrides,
  }
}

const kinds = (trail: ReturnType<typeof buildConversionTrail>) =>
  trail.events.map((event) => (event.kind === "click" ? `${event.role}-click` : event.kind))

describe("trailClicks", () => {
  it("returns the first and the last click when they differ", () => {
    const { first, last } = trailClicks(attribution(), input().clicks)
    expect(first?.id).toBe("click-1")
    expect(last?.id).toBe("click-2")
  })

  it("shows a single click once when first and last are the same row", () => {
    const { first, last } = trailClicks(
      attribution({ firstClickId: "click-1", lastClickId: "click-1" }),
      [click("click-1", "2026-09-02T10:00:00Z")],
    )
    expect(first?.id).toBe("click-1")
    expect(last).toBeNull()
  })

  it("falls back to the surviving click as the first one", () => {
    const { first, last } = trailClicks(attribution({ firstClickId: null }), input().clicks)
    expect(first?.id).toBe("click-2")
    expect(last).toBeNull()
  })

  it("has no clicks without an attribution", () => {
    expect(trailClicks(null, input().clicks)).toEqual({ first: null, last: null })
  })
})

describe("buildConversionTrail", () => {
  it("orders click → click → identified → payment → commission", () => {
    const trail = buildConversionTrail(input())
    expect(kinds(trail)).toEqual(["first-click", "last-click", "identified", "transaction", "commission"])
    expect(trail.attributionState).toBe("matched")
  })

  it("dedupes the last click when it is the first", () => {
    const trail = buildConversionTrail(
      input({
        attribution: attribution({ lastClickId: "click-1" }),
        clicks: [click("click-1", "2026-09-02T10:00:00Z")],
      }),
    )
    expect(kinds(trail)).toEqual(["first-click", "identified", "transaction", "commission"])
  })

  it("keeps a commission next to its payment even when it was written later", () => {
    const trail = buildConversionTrail(
      input({
        conversionId: "com-2",
        transactions: [transaction("tx-2", "2026-10-14T12:00:00Z"), transaction("tx-1", "2026-09-14T12:00:00Z")],
        commissions: [
          // Backfilled: written after the second payment happened.
          commission("com-1", "tx-1", "2026-10-20T00:00:00Z"),
          commission("com-2", "tx-2", "2026-10-14T12:00:05Z"),
        ],
      }),
    )
    const money = trail.events
      .filter((event) => event.kind === "transaction" || event.kind === "commission")
      .map((event) => (event.kind === "transaction" ? event.transaction.id : event.commission.id))
    expect(money).toEqual(["tx-1", "com-1", "tx-2", "com-2"])

    const highlighted = trail.events.filter(
      (event) => (event.kind === "transaction" || event.kind === "commission") && event.highlighted,
    )
    expect(highlighted).toHaveLength(2)
  })

  it("places a reversal after the refund it answers", () => {
    const trail = buildConversionTrail(
      input({
        transactions: [transaction("tx-1", "2026-09-14T12:00:00Z"), transaction("re-1", "2026-09-20T09:00:00Z", "refund")],
        commissions: [
          commission("com-1", "tx-1", "2026-09-14T12:00:05Z", { status: "reversed" }),
          commission("rev-1", "re-1", "2026-09-20T09:00:03Z", {
            commissionAmountMinor: -1470,
            reversalOfCommissionId: "com-1",
            reversedAt: new Date("2026-09-20T09:00:03Z"),
          }),
        ],
      }),
    )
    expect(kinds(trail).slice(-4)).toEqual(["transaction", "commission", "transaction", "reversal"])
    const reversal = trail.events.at(-1)
    expect(reversal?.kind === "reversal" && reversal.transaction?.id).toBe("re-1")
  })

  it("does not let a click after the first payment push identification past it", () => {
    const trail = buildConversionTrail(
      input({
        attribution: attribution({ model: "first_click" }),
        clicks: [click("click-1", "2026-09-02T10:00:00Z"), click("click-2", "2026-09-30T10:00:00Z", "pa-maria")],
      }),
    )
    expect(kinds(trail)).toEqual(["first-click", "identified", "transaction", "commission", "last-click"])
    const late = trail.events.at(-1)
    expect(late?.kind === "click" && late.otherAffiliate).toBe(true)
  })

  it("reports a missing attribution and still draws the money", () => {
    const trail = buildConversionTrail(
      input({
        attribution: null,
        clicks: [],
        customer: { ...input().customer, externalId: null },
      }),
    )
    expect(trail.attributionState).toBe("missing")
    expect(kinds(trail)).toEqual(["transaction", "commission"])
  })

  it("reports an attribution that now credits someone else", () => {
    const trail = buildConversionTrail(input({ attribution: attribution({ participationId: "pa-maria" }) }))
    expect(trail.attributionState).toBe("moved")
  })
})

describe("landingPath", () => {
  it("keeps path and query only", () => {
    expect(landingPath("https://produto.com/precos?ref=joao")).toBe("/precos?ref=joao")
    expect(landingPath("not a url")).toBe("not a url")
  })
})
