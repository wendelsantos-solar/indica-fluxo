import { describe, expect, it } from "vitest"

import { PLAN_CAPABILITIES } from "@/lib/plans"

import {
  billingStatusLabel,
  capabilityLines,
  planOptions,
  upgradeOffer,
  usageMeters,
  usageValue,
} from "../plan-display"

const date = new Date("2026-10-01T00:00:00Z")
const base = { endsAt: null, graceEndsAt: null, trialEndsAt: null, status: "active" as const }

describe("billingStatusLabel", () => {
  it("names each standing", () => {
    expect(billingStatusLabel({ ...base, standing: "sandbox", status: "free" })).toEqual({
      key: "sandbox",
      tone: "neutral",
      date: null,
    })
    expect(billingStatusLabel({ ...base, standing: "active" })).toMatchObject({ key: "active", tone: "success" })
    expect(billingStatusLabel({ ...base, standing: "restricted", status: "past_due" })).toMatchObject({
      key: "restricted",
      tone: "danger",
    })
  })

  it("carries the grace end, the cancellation date and the trial end", () => {
    expect(billingStatusLabel({ ...base, standing: "grace", status: "past_due", graceEndsAt: date })).toEqual({
      key: "grace",
      tone: "warning",
      date,
    })
    expect(billingStatusLabel({ ...base, standing: "active", endsAt: date })).toEqual({
      key: "cancelling",
      tone: "warning",
      date,
    })
    expect(billingStatusLabel({ ...base, standing: "active", status: "trialing", trialEndsAt: date })).toEqual({
      key: "trialing",
      tone: "info",
      date,
    })
  })

  it("lets a payment problem outrank a scheduled cancellation", () => {
    expect(
      billingStatusLabel({ ...base, standing: "grace", status: "past_due", graceEndsAt: date, endsAt: date }).key,
    ).toBe("grace")
    expect(billingStatusLabel({ ...base, standing: "active", status: "trialing", endsAt: date }).key).toBe(
      "cancelling",
    )
  })
})

describe("usage meters", () => {
  it("formats limited meters as used / limit and unlimited ones as the count alone", () => {
    const meters = usageMeters(
      { livePrograms: 3, testPrograms: 1, affiliates: 391, members: 2 },
      PLAN_CAPABILITIES.growth.limits,
    )
    const byLimit = Object.fromEntries(meters.map((meter) => [meter.limit, meter]))

    expect(usageValue(byLimit.affiliates!)).toEqual({ key: "usageCount", values: { used: 391 } })
    expect(usageValue(byLimit.members!)).toEqual({ key: "usageOf", values: { used: 2, limit: 10 } })
    expect(byLimit.affiliates!.state).toBe("within")
  })

  it("marks full, over and unavailable limits", () => {
    const meters = usageMeters(
      { livePrograms: 0, testPrograms: 1, affiliates: 12, members: 1 },
      PLAN_CAPABILITIES.sandbox.limits,
    )
    expect(meters.map((meter) => [meter.limit, meter.state])).toEqual([
      ["livePrograms", "unavailable"],
      ["testPrograms", "atLimit"],
      ["affiliates", "over"],
      ["members", "atLimit"],
    ])
    expect(usageValue(meters[0]!)).toEqual({ key: "usageUnavailable", values: {} })
    expect(usageValue(meters[2]!)).toEqual({ key: "usageOf", values: { used: 12, limit: 10 } })
  })

  it("reads live programs above a zero limit as over, not unavailable", () => {
    const [live] = usageMeters(
      { livePrograms: 2, testPrograms: 0, affiliates: 0, members: 1 },
      PLAN_CAPABILITIES.sandbox.limits,
    )
    expect(live!.state).toBe("over")
  })
})

describe("upgradeOffer", () => {
  it("offers Growth at R$ 197 for a second live program on Launch", () => {
    expect(upgradeOffer("livePrograms", { currentPlan: "launch" })).toEqual({
      plan: "growth",
      priceMonthlyMinor: 19700,
      currency: "BRL",
    })
  })

  it("offers Launch for a first live program from Sandbox", () => {
    expect(upgradeOffer("livePrograms", { currentPlan: "sandbox" })?.plan).toBe("launch")
    expect(upgradeOffer("liveMode", { currentPlan: "sandbox" })?.plan).toBe("launch")
  })

  it("uses the cheapest plan with the feature or room for what is needed", () => {
    expect(upgradeOffer("auditLog")?.plan).toBe("growth")
    expect(upgradeOffer("customAffiliateRates", { currentPlan: "sandbox" })?.plan).toBe("growth")
    expect(upgradeOffer("affiliates", { currentPlan: "sandbox", needed: 11 })?.plan).toBe("launch")
    expect(upgradeOffer("affiliates", { currentPlan: "sandbox", needed: 101 })?.plan).toBe("growth")
    expect(upgradeOffer("affiliates", { needed: 101 })?.plan).toBe("growth")
  })

  it("prefers the plan an error names, but never one at or below the current plan", () => {
    expect(upgradeOffer("members", { currentPlan: "sandbox", upgradeTo: "growth" })?.plan).toBe("growth")
    expect(upgradeOffer("members", { currentPlan: "growth", upgradeTo: "launch" })).toBeNull()
    expect(upgradeOffer("members", { upgradeTo: "scale" })?.plan).toBe("launch")
  })

  it("offers nothing when no purchasable plan helps", () => {
    expect(upgradeOffer("members", { currentPlan: "growth" })).toBeNull()
    expect(upgradeOffer("auditLog", { currentPlan: "growth" })).toBeNull()
  })
})

describe("planOptions", () => {
  const sandbox = {
    subscribedPlan: "sandbox" as const,
    standing: "sandbox" as const,
    configured: true,
    canManageBilling: false,
    provider: null,
  }

  it("offers Launch and Growth through Checkout from Sandbox, Growth recommended", () => {
    expect(planOptions(sandbox)).toEqual([
      { plan: "launch", recommended: false, downgrade: false, action: { kind: "checkout" } },
      { plan: "growth", recommended: true, downgrade: false, action: { kind: "checkout" } },
    ])
  })

  it("falls back to a manual request without platform billing", () => {
    expect(planOptions({ ...sandbox, configured: false }).map((option) => option.action.kind)).toEqual([
      "request",
      "request",
    ])
  })

  it("changes between paid plans in the Billing Portal", () => {
    const launch = { ...sandbox, subscribedPlan: "launch" as const, standing: "active" as const, canManageBilling: true, provider: "stripe" as const }
    expect(planOptions(launch)).toEqual([
      { plan: "growth", recommended: true, downgrade: false, action: { kind: "portalChange" } },
    ])
    expect(planOptions({ ...launch, subscribedPlan: "growth" })).toEqual([
      { plan: "launch", recommended: false, downgrade: true, action: { kind: "portalChange" } },
    ])
  })

  it("has no self-service change for a manually granted plan, and nothing above Scale", () => {
    const manual = { ...sandbox, subscribedPlan: "growth" as const, standing: "active" as const, provider: "manual" as const }
    expect(planOptions(manual)[0]?.action.kind).toBe("contact")
    expect(planOptions({ ...manual, configured: false })[0]?.action.kind).toBe("contact")
    expect(planOptions({ ...manual, subscribedPlan: "launch", configured: false })[0]?.action.kind).toBe("request")
    expect(planOptions({ ...manual, subscribedPlan: "scale" })).toEqual([])
  })
})

describe("capabilityLines", () => {
  it("words every limit and the gated features from PLAN_CAPABILITIES", () => {
    expect(capabilityLines("launch")).toEqual([
      { kind: "limit", limit: "livePrograms", max: 1 },
      { kind: "limit", limit: "testPrograms", max: 1 },
      { kind: "limit", limit: "affiliates", max: 100 },
      { kind: "limit", limit: "members", max: 2 },
      { kind: "feature", feature: "customAffiliateRates", included: false },
      { kind: "feature", feature: "auditLog", included: false },
    ])
    expect(capabilityLines("growth").filter((line) => line.kind === "feature").every((line) => line.included)).toBe(
      true,
    )
  })
})
