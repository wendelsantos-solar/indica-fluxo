import { describe, expect, it, vi } from "vitest"

vi.mock("next-intl/server", () => ({
  getTranslations: async () => {
    const t = (key: string) => `t:${key}`
    t.has = (key: string) => key.startsWith("plan.") || key === "generic" || key === "programNotCreated"
    return t
  },
}))

import {
  ConflictError,
  FeatureNotAvailableError,
  LiveModeRequiredError,
  PlanLimitReachedError,
  SubscriptionRequiredError,
} from "@/server/policies/errors"

import { actionFailure, planUpgradeHint } from "../errors"

describe("planUpgradeHint", () => {
  it("reads the limit and plan off PLAN_LIMIT_REACHED", () => {
    expect(planUpgradeHint(new PlanLimitReachedError("livePrograms", 1, "growth"))).toEqual({
      code: "PLAN_LIMIT_REACHED",
      reason: "livePrograms",
      upgradeTo: "growth",
    })
    expect(planUpgradeHint(new PlanLimitReachedError("members", 10, null))?.upgradeTo).toBeNull()
  })

  it("reads the feature off FEATURE_NOT_AVAILABLE and live mode off LIVE_MODE_REQUIRED", () => {
    expect(planUpgradeHint(new FeatureNotAvailableError("auditLog", "growth"))).toEqual({
      code: "FEATURE_NOT_AVAILABLE",
      reason: "auditLog",
      upgradeTo: "growth",
    })
    expect(planUpgradeHint(new LiveModeRequiredError())).toEqual({
      code: "LIVE_MODE_REQUIRED",
      reason: "liveMode",
      upgradeTo: null,
    })
  })

  it("ignores every other failure, and unknown limit or plan names", () => {
    expect(planUpgradeHint(new SubscriptionRequiredError())).toBeUndefined()
    expect(planUpgradeHint(new ConflictError("nope"))).toBeUndefined()
    expect(planUpgradeHint(new Error("boom"))).toBeUndefined()
    expect(planUpgradeHint(new PlanLimitReachedError("programs", 1, "growth"))).toBeUndefined()
    expect(planUpgradeHint(new FeatureNotAvailableError("auditLog", "enterprise"))?.upgradeTo).toBeNull()
  })
})

describe("actionFailure", () => {
  it("adds the hint to the translated error for plan refusals only", async () => {
    await expect(actionFailure(new PlanLimitReachedError("affiliates", 100, "growth"), "programNotCreated")).resolves.toEqual({
      error: "t:plan.limit.affiliates",
      upgrade: { code: "PLAN_LIMIT_REACHED", reason: "affiliates", upgradeTo: "growth" },
    })
    await expect(actionFailure(new Error("boom"), "programNotCreated")).resolves.toEqual({
      error: "t:programNotCreated",
    })
  })
})
