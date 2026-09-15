import { describe, expect, it } from "vitest"

import { PLAN_CAPABILITIES, PLAN_CODES, PLAN_FEATURES, PLAN_LIMITS, PLAN_OFFERS, planRank } from "../plans"
import {
  capabilityLines,
  CORE_FEATURES,
  formatPlanPrice,
  lineId,
  lineMessage,
  cardLines,
  PAID_PLAN_DISPLAY,
  PRICING_CARDS,
  PUBLIC_PAID_PLANS,
  START_PLAN,
  START_PLAN_DISPLAY,
  type DisplayLine,
} from "../plans-display"

function display(code: string) {
  const plan = PAID_PLAN_DISPLAY.find((entry) => entry.code === code)
  if (!plan) throw new Error(`${code} is not displayed`)
  return plan
}

function limitLine(lines: readonly DisplayLine[], limit: string) {
  return lines.find((line) => (line.kind === "limit" || line.kind === "unlimited") && line.limit === limit)
}

describe("public plan display", () => {
  it("shows Launch and Growth as the paid plans, cheapest first, and never Scale", () => {
    expect(PUBLIC_PAID_PLANS).toEqual(["launch", "growth"])
    expect(PAID_PLAN_DISPLAY.map((plan) => plan.code)).not.toContain("scale")
    expect(START_PLAN_DISPLAY.code).not.toBe("scale")
    expect(PLAN_OFFERS.scale.public).toBe(false)
  })

  it("presents Sandbox as the free start, not as a paid card", () => {
    expect(START_PLAN).toBe("sandbox")
    expect(PAID_PLAN_DISPLAY.map((plan) => plan.code)).not.toContain("sandbox")
    expect(PLAN_OFFERS[START_PLAN].priceMonthlyMinor).toBe(0)
  })

  it("reads prices and the recommended flag from PLAN_OFFERS", () => {
    for (const plan of PAID_PLAN_DISPLAY) {
      expect(plan.priceMonthlyMinor).toBe(PLAN_OFFERS[plan.code].priceMonthlyMinor)
      expect(plan.currency).toBe(PLAN_OFFERS[plan.code].currency)
      expect(plan.recommended).toBe(PLAN_OFFERS[plan.code].recommended)
    }
    expect(display("growth").recommended).toBe(true)
    expect(display("launch").recommended).toBe(false)
  })

  it("says 100 affiliates on Launch because PLAN_CAPABILITIES says 100", () => {
    const line = limitLine(display("launch").lines, "affiliates")
    expect(line).toEqual({ kind: "limit", limit: "affiliates", value: PLAN_CAPABILITIES.launch.limits.affiliates })
    expect(line && lineMessage(line)).toEqual({ key: "pricing.lines.limit.affiliates", values: { count: 100 } })
  })

  it("renders every limit of a plan exactly as its capability: count, unlimited, or absent when zero", () => {
    for (const code of PLAN_CODES) {
      const lines = capabilityLines(code)
      for (const limit of PLAN_LIMITS) {
        const value = PLAN_CAPABILITIES[code].limits[limit]
        const line = limitLine(lines, limit)
        if (value === null) expect(line).toEqual({ kind: "unlimited", limit })
        else if (value === 0) expect(line).toBeUndefined()
        else expect(line).toEqual({ kind: "limit", limit, value })
      }
    }
  })

  it("never lists a feature that PLAN_CAPABILITIES disables", () => {
    const shown = [
      ...PAID_PLAN_DISPLAY.map((plan) => ({ code: plan.code, lines: plan.lines })),
      { code: START_PLAN_DISPLAY.code, lines: START_PLAN_DISPLAY.lines },
    ]
    for (const { code, lines } of shown) {
      for (const line of lines) {
        if (line.kind === "feature") expect(PLAN_CAPABILITIES[code].features[line.feature]).toBe(true)
      }
    }
    expect(START_PLAN_DISPLAY.lines.some((line) => line.kind === "feature")).toBe(false)
  })

  it("lists every enabled feature of the first paid plan", () => {
    const launch = display("launch")
    for (const feature of PLAN_FEATURES) {
      const listed = launch.lines.some((line) => line.kind === "feature" && line.feature === feature)
      expect(listed).toBe(PLAN_CAPABILITIES.launch.features[feature])
    }
  })

  it("lists the core once, on the first paid plan", () => {
    const launch = display("launch")
    expect(launch.extends).toBeNull()
    for (const item of CORE_FEATURES) {
      expect(launch.lines).toContainEqual({ kind: "core", item })
    }
  })

  it("Growth's 'Everything in Launch, plus' list repeats nothing Launch lists", () => {
    const growth = display("growth")
    const launchIds = new Set(display("launch").lines.map(lineId))
    expect(growth.extends).toBe("launch")
    expect(growth.lines.length).toBeGreaterThan(0)
    for (const line of growth.lines) expect(launchIds.has(lineId(line))).toBe(false)
    expect(growth.lines.some((line) => line.kind === "core")).toBe(false)
  })

  it("Growth's list is what Growth adds: unlimited programs and affiliates, 10 members, custom rates, audit log", () => {
    expect(display("growth").lines).toEqual([
      { kind: "unlimited", limit: "livePrograms" },
      { kind: "unlimited", limit: "testPrograms" },
      { kind: "unlimited", limit: "affiliates" },
      { kind: "limit", limit: "members", value: PLAN_CAPABILITIES.growth.limits.members },
      { kind: "feature", feature: "customAffiliateRates" },
      { kind: "feature", feature: "auditLog" },
    ])
  })

  it("a plan that extends another really includes everything the other one has", () => {
    for (const plan of PAID_PLAN_DISPLAY) {
      if (!plan.extends) continue
      expect(planRank(plan.code)).toBeGreaterThan(planRank(plan.extends))
      const base = PLAN_CAPABILITIES[plan.extends]
      const own = PLAN_CAPABILITIES[plan.code]
      for (const feature of PLAN_FEATURES) {
        if (base.features[feature]) expect(own.features[feature]).toBe(true)
      }
      for (const limit of PLAN_LIMITS) {
        const baseValue = base.limits[limit]
        const ownValue = own.limits[limit]
        if (ownValue !== null) expect(baseValue === null ? false : ownValue >= baseValue).toBe(true)
      }
    }
  })

  it("every public CTA leads to sign-up", () => {
    for (const plan of PAID_PLAN_DISPLAY) expect(plan.cta.href).toBe("/signup")
    expect(START_PLAN_DISPLAY.cta.href).toBe("/signup")
  })
})

describe("formatPlanPrice", () => {
  it("prints whole BRL prices without cents, in BRL in every locale", () => {
    expect(formatPlanPrice("pt-br", 9900, "BRL").replace(/\s/g, " ")).toBe("R$ 99")
    expect(formatPlanPrice("pt-br", 19700, "BRL").replace(/\s/g, " ")).toBe("R$ 197")
    expect(formatPlanPrice("en", 9900, "BRL")).toBe("R$99")
  })

  it("keeps cents when the price has them, and never abbreviates large prices", () => {
    expect(formatPlanPrice("pt-br", 9990, "BRL").replace(/\s/g, " ")).toBe("R$ 99,90")
    expect(formatPlanPrice("pt-br", 149700, "BRL").replace(/\s/g, " ")).toBe("R$ 1.497,00")
  })
})

describe("pricing cards", () => {
  it("shows Sandbox, Launch and Growth in that order, never Scale", () => {
    expect(PRICING_CARDS.map((card) => card.code)).toEqual(["sandbox", "launch", "growth"])
  })

  it("opens each card with its mode, from the liveMode capability", () => {
    expect(cardLines("sandbox")[0]).toEqual({ kind: "mode", live: false })
    expect(cardLines("launch")[0]).toEqual({ kind: "mode", live: true })
    expect(cardLines("growth")[0]).toEqual({ kind: "mode", live: true })
  })

  it("lists every limit on every card, so cards compare line by line, and no core item", () => {
    const launch = cardLines("launch")
    expect(launch).toContainEqual({ kind: "limit", limit: "livePrograms", value: 1 })
    expect(launch).toContainEqual({ kind: "limit", limit: "affiliates", value: 100 })
    expect(launch).toContainEqual({ kind: "limit", limit: "members", value: 2 })
    for (const code of ["sandbox", "launch", "growth"] as const) {
      expect(cardLines(code).some((line) => line.kind === "core")).toBe(false)
    }
  })

  it("says unlimited programs once on Growth, and lists only features the plan has", () => {
    const growth = cardLines("growth")
    expect(growth).toContainEqual({ kind: "programsUnlimited" })
    expect(growth.some((line) => line.kind === "unlimited" && line.limit === "livePrograms")).toBe(false)
    expect(growth).toContainEqual({ kind: "feature", feature: "customAffiliateRates" })
    expect(cardLines("launch").some((line) => line.kind === "feature")).toBe(false)
    expect(cardLines("sandbox").some((line) => line.kind === "limit" && line.limit === "livePrograms")).toBe(false)
  })

  it("makes Growth the only primary action and sends every card to sign-up", () => {
    expect(PRICING_CARDS.filter((card) => card.recommended).map((card) => card.code)).toEqual(["growth"])
    for (const card of PRICING_CARDS) expect(card.cta.href).toBe("/signup")
    expect(PRICING_CARDS[0]!.cta.key).toBe("pricing.cta.createFreeAccount")
  })
})
