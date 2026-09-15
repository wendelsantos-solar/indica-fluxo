import { describe, expect, it } from "vitest"

import {
  cheapestPlanForLimit,
  cheapestPlanWithFeature,
  fitsLimit,
  PLAN_CAPABILITIES,
  PLAN_CODES,
  PLAN_OFFERS,
  planHasFeature,
  planLimit,
  PURCHASABLE_PLANS,
} from "../plans"

describe("plan capabilities", () => {
  it("sandbox is test-only and free", () => {
    expect(planHasFeature("sandbox", "liveMode")).toBe(false)
    expect(planLimit("sandbox", "livePrograms")).toBe(0)
    expect(planLimit("sandbox", "testPrograms")).toBe(1)
    expect(PLAN_OFFERS.sandbox.priceMonthlyMinor).toBe(0)
    expect(PLAN_OFFERS.sandbox.purchasable).toBe(false)
  })

  it("launch carries the core in production: 1 live program, 100 affiliates, 2 members", () => {
    expect(planHasFeature("launch", "liveMode")).toBe(true)
    expect(planLimit("launch", "livePrograms")).toBe(1)
    expect(planLimit("launch", "affiliates")).toBe(100)
    expect(planLimit("launch", "members")).toBe(2)
    expect(planHasFeature("launch", "customAffiliateRates")).toBe(false)
    expect(planHasFeature("launch", "auditLog")).toBe(false)
    expect(PLAN_OFFERS.launch.priceMonthlyMinor).toBe(9900)
  })

  it("growth adds scale and control: unlimited programs and affiliates, 10 members, custom rates, audit log", () => {
    expect(planLimit("growth", "livePrograms")).toBeNull()
    expect(planLimit("growth", "affiliates")).toBeNull()
    expect(planLimit("growth", "members")).toBe(10)
    expect(planHasFeature("growth", "customAffiliateRates")).toBe(true)
    expect(planHasFeature("growth", "auditLog")).toBe(true)
    expect(PLAN_OFFERS.growth.priceMonthlyMinor).toBe(19700)
    expect(PLAN_OFFERS.growth.recommended).toBe(true)
  })

  it("scale is modelled but not public or purchasable", () => {
    expect(PLAN_CODES).toContain("scale")
    expect(PLAN_OFFERS.scale.public).toBe(false)
    expect(PURCHASABLE_PLANS).toEqual(["launch", "growth"])
  })

  it("never uses a sentinel for unlimited", () => {
    for (const code of PLAN_CODES) {
      for (const value of Object.values(PLAN_CAPABILITIES[code].limits)) {
        expect(value === null || value < 1000).toBe(true)
      }
    }
  })

  it("each higher plan includes at least what the lower one does", () => {
    const order = ["sandbox", "launch", "growth"] as const
    for (let i = 1; i < order.length; i++) {
      const lower = PLAN_CAPABILITIES[order[i - 1]!]
      const higher = PLAN_CAPABILITIES[order[i]!]
      for (const [limit, max] of Object.entries(lower.limits)) {
        const next = higher.limits[limit as keyof typeof lower.limits]
        expect(next === null || (max !== null && next >= max)).toBe(true)
      }
      for (const [feature, on] of Object.entries(lower.features)) {
        if (on) expect(higher.features[feature as keyof typeof lower.features]).toBe(true)
      }
    }
  })
})

describe("limit helpers", () => {
  it("fitsLimit treats null as unlimited", () => {
    expect(fitsLimit(null, 10_000)).toBe(true)
    expect(fitsLimit(1, 0)).toBe(true)
    expect(fitsLimit(1, 1)).toBe(false)
    expect(fitsLimit(100, 99)).toBe(true)
    expect(fitsLimit(100, 100)).toBe(false)
  })

  it("points upgrades at the cheapest plan that fits", () => {
    expect(cheapestPlanForLimit("livePrograms", 2)).toBe("growth")
    expect(cheapestPlanForLimit("livePrograms", 1)).toBe("launch")
    expect(cheapestPlanForLimit("members", 11)).toBeNull()
    expect(cheapestPlanWithFeature("customAffiliateRates")).toBe("growth")
    expect(cheapestPlanWithFeature("liveMode")).toBe("launch")
  })
})
