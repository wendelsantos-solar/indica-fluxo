import { describe, expect, it } from "vitest"

import { billingBannerKind } from "../billing-banner"

const endsAt = new Date("2026-10-01T00:00:00Z")

describe("billingBannerKind", () => {
  it("shows nothing for Sandbox or a renewing plan", () => {
    expect(billingBannerKind({ standing: "sandbox", endsAt: null })).toBeNull()
    expect(billingBannerKind({ standing: "active", endsAt: null })).toBeNull()
  })

  it("warns during grace and alarms once restricted", () => {
    expect(billingBannerKind({ standing: "grace", endsAt: null })).toBe("grace")
    expect(billingBannerKind({ standing: "restricted", endsAt: null })).toBe("restricted")
  })

  it("announces a scheduled end, unless a payment problem is more urgent", () => {
    expect(billingBannerKind({ standing: "active", endsAt })).toBe("ending")
    expect(billingBannerKind({ standing: "grace", endsAt })).toBe("grace")
    expect(billingBannerKind({ standing: "restricted", endsAt })).toBe("restricted")
  })
})
