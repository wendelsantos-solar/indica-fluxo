import { describe, expect, it } from "vitest"

import { overLimits, PAST_DUE_GRACE_DAYS, resolveEntitlements, type SubscriptionSnapshot } from "../entitlements"

const NOW = new Date("2026-09-15T12:00:00Z")
const DAY = 86_400_000

function sub(overrides: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return { plan: "launch", status: "active", cancelAtPeriodEnd: false, currentPeriodEnd: null, pastDueSince: null, ...overrides }
}

describe("resolveEntitlements", () => {
  it("no subscription is Sandbox", () => {
    const e = resolveEntitlements(null, NOW)
    expect(e.plan).toBe("sandbox")
    expect(e.capabilities.features.liveMode).toBe(false)
    expect(e.canCreate).toBe(true)
  })

  it("an active Launch subscription enables live mode", () => {
    const e = resolveEntitlements(sub(), NOW)
    expect(e.plan).toBe("launch")
    expect(e.standing).toBe("active")
    expect(e.capabilities.features.liveMode).toBe(true)
  })

  it.each(["free", "incomplete", "cancelled"] as const)("%s falls back to Sandbox without touching data", (status) => {
    const e = resolveEntitlements(sub({ plan: "growth", status }), NOW)
    expect(e.plan).toBe("sandbox")
    expect(e.capabilities.features.liveMode).toBe(false)
  })

  it("a cancellation keeps the plan until period end, then Sandbox", () => {
    const before = resolveEntitlements(
      sub({ plan: "growth", cancelAtPeriodEnd: true, currentPeriodEnd: new Date(NOW.getTime() + DAY) }),
      NOW,
    )
    expect(before.plan).toBe("growth")
    expect(before.endsAt).not.toBeNull()

    const after = resolveEntitlements(
      sub({ plan: "growth", cancelAtPeriodEnd: true, currentPeriodEnd: new Date(NOW.getTime() - 1) }),
      NOW,
    )
    expect(after.plan).toBe("sandbox")
  })

  it("past_due keeps the plan during the grace period", () => {
    const e = resolveEntitlements(sub({ status: "past_due", pastDueSince: new Date(NOW.getTime() - DAY) }), NOW)
    expect(e.standing).toBe("grace")
    expect(e.capabilities.features.liveMode).toBe(true)
    expect(e.graceEndsAt?.getTime()).toBe(NOW.getTime() - DAY + PAST_DUE_GRACE_DAYS * DAY)
  })

  it("past_due after the grace period stops live mode and creation, keeps reads and limits", () => {
    const e = resolveEntitlements(
      sub({ plan: "growth", status: "past_due", pastDueSince: new Date(NOW.getTime() - (PAST_DUE_GRACE_DAYS + 1) * DAY) }),
      NOW,
    )
    expect(e.standing).toBe("restricted")
    expect(e.capabilities.features.liveMode).toBe(false)
    expect(e.capabilities.features.auditLog).toBe(true)
    expect(e.canCreate).toBe(false)
  })
})

describe("overLimits", () => {
  it("reports limits exceeded after a downgrade, and none when unlimited", () => {
    const launch = resolveEntitlements(sub(), NOW)
    expect(overLimits(launch, { livePrograms: 3, testPrograms: 0, affiliates: 150, members: 2 })).toEqual([
      "livePrograms",
      "affiliates",
    ])
    const growth = resolveEntitlements(sub({ plan: "growth" }), NOW)
    expect(overLimits(growth, { livePrograms: 30, testPrograms: 9, affiliates: 5000, members: 10 })).toEqual([])
  })
})
