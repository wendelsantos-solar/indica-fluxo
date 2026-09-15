import { describe, expect, it } from "vitest"

import { marketingPlanLines, MARKETING_PLANS, PRICE_MINOR } from "@/app/[locale]/(marketing)/_lib/plans"

import {
  fitsPlan,
  hasPlanFeature,
  nextPlan,
  PLAN_KEYS,
  PLANS,
  planLimit,
  planLines,
  planWithFeature,
  upgradeLines,
} from "../plans"

describe("plans", () => {
  it("caps starter at one program and ten affiliates", () => {
    expect(fitsPlan("starter", "programs", 0)).toBe(true)
    expect(fitsPlan("starter", "programs", 1)).toBe(false)
    expect(fitsPlan("starter", "affiliates", 9)).toBe(true)
    expect(fitsPlan("starter", "affiliates", 10)).toBe(false)
    expect(fitsPlan("starter", "members", 1)).toBe(false)
  })

  it("lifts program and affiliate limits on growth", () => {
    expect(planLimit("growth", "programs")).toBeNull()
    expect(fitsPlan("growth", "affiliates", 10_000)).toBe(true)
    expect(fitsPlan("growth", "members", 9)).toBe(true)
    expect(fitsPlan("growth", "members", 10)).toBe(false)
  })

  it("gates growth features", () => {
    expect(hasPlanFeature("starter", "customRates")).toBe(false)
    expect(hasPlanFeature("growth", "auditLog")).toBe(true)
    expect(planWithFeature("teamInvites")).toBe("growth")
  })

  it("orders plans for the upgrade path", () => {
    expect(nextPlan("starter")).toBe("growth")
    expect(nextPlan("growth")).toBeNull()
  })

  it("lists only what an upgrade actually adds", () => {
    const added = upgradeLines("starter", "growth")
    expect(added).toContainEqual({ kind: "limit", resource: "programs", limit: null })
    expect(added).toContainEqual({ kind: "feature", feature: "auditLog", included: true })
    expect(added.every((line) => line.kind !== "feature" || line.included)).toBe(true)
  })
})

describe("marketing plan lines", () => {
  it("prices exactly the plans that exist", () => {
    expect(MARKETING_PLANS.map((plan) => plan.key)).toEqual([...PLAN_KEYS])
    for (const prices of Object.values(PRICE_MINOR)) {
      expect(Object.keys(prices).sort()).toEqual([...PLAN_KEYS].sort())
      expect(prices.starter).toBe(0)
    }
  })

  it.each(PLAN_KEYS)("derives every limit and feature of %s from PLANS", (key) => {
    const lines = marketingPlanLines(key)
    expect(lines.slice(0, planLines(key).length)).toEqual(planLines(key))

    for (const [resource, limit] of Object.entries(PLANS[key].limits)) {
      expect(lines).toContainEqual({ kind: "limit", resource, limit })
    }
    for (const [feature, included] of Object.entries(PLANS[key].features)) {
      expect(lines).toContainEqual({ kind: "feature", feature, included })
    }
    // Everything else is an ungated base item, never a hand-typed plan perk.
    expect(lines.filter((line) => line.kind !== "limit" && line.kind !== "feature").every((line) => line.kind === "base")).toBe(true)
  })

  it("changes with the table, not with copy", () => {
    const starter = marketingPlanLines("starter")
    expect(starter).toContainEqual({ kind: "limit", resource: "affiliates", limit: PLANS.starter.limits.affiliates })
    expect(starter).toContainEqual({ kind: "feature", feature: "customRates", included: false })
  })
})
