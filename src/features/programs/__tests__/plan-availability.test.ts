import { describe, expect, it } from "vitest"

import { resolveEntitlements, type PlanUsage } from "@/server/domain/entitlements"

import { programAvailability } from "../plan-availability"

const NOW = new Date("2026-09-14T12:00:00Z")
const usage = (overrides: Partial<PlanUsage> = {}): PlanUsage => ({
  livePrograms: 0,
  testPrograms: 0,
  affiliates: 0,
  members: 1,
  ...overrides,
})
const subscribed = (plan: "launch" | "growth", extra: { status?: "active" | "past_due"; pastDueSince?: Date } = {}) =>
  resolveEntitlements(
    {
      plan,
      status: extra.status ?? "active",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      pastDueSince: extra.pastDueSince ?? null,
    },
    NOW,
  )

describe("programAvailability", () => {
  it("Sandbox: one test program, no live mode", () => {
    const sandbox = resolveEntitlements(null, NOW)
    expect(programAvailability(sandbox, usage())).toEqual({
      test: true,
      live: false,
      liveBlockedBy: "plan",
      restricted: false,
      upgradeTo: null,
    })
    expect(programAvailability(sandbox, usage({ testPrograms: 1 }))).toMatchObject({ test: false, upgradeTo: "growth" })
  })

  it("Launch: one live program, then the Growth notice", () => {
    expect(programAvailability(subscribed("launch"), usage())).toMatchObject({ live: true, liveBlockedBy: null })
    expect(programAvailability(subscribed("launch"), usage({ livePrograms: 1 }))).toMatchObject({
      live: false,
      liveBlockedBy: "limit",
      upgradeTo: "growth",
    })
  })

  it("Growth: unlimited", () => {
    expect(programAvailability(subscribed("growth"), usage({ livePrograms: 40, testPrograms: 9 }))).toMatchObject({
      test: true,
      live: true,
      upgradeTo: null,
    })
  })

  it("past due beyond grace: nothing is offered and no upgrade is suggested", () => {
    const restricted = subscribed("growth", { status: "past_due", pastDueSince: new Date("2026-08-01T00:00:00Z") })
    expect(programAvailability(restricted, usage())).toEqual({
      test: false,
      live: false,
      liveBlockedBy: null,
      restricted: true,
      upgradeTo: null,
    })
  })
})
