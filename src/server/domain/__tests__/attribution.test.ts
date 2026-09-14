import { describe, expect, it } from "vitest"

import {
  expiryFrom,
  isAttributionValidAt,
  isExpired,
  resolveAttribution,
  type AttributionState,
} from "../attribution"
import { AT } from "./fixtures"

const NOW = AT("2026-09-01T12:00:00Z")

function state(overrides: Partial<AttributionState> = {}): AttributionState {
  return {
    programAffiliateId: "pa_wendel",
    firstClickId: "click_1",
    lastClickId: "click_1",
    attributedAt: AT("2026-08-01T00:00:00Z"),
    expiresAt: AT("2026-09-30T00:00:00Z"),
    ...overrides,
  }
}

const click = (id: string, pa: string, at = "2026-09-01T10:00:00Z") => ({
  clickId: id,
  programAffiliateId: pa,
  occurredAt: AT(at),
})

describe("window arithmetic", () => {
  it("expires exactly N days after the click", () => {
    expect(expiryFrom(AT("2026-09-01T00:00:00Z"), 60).toISOString()).toBe(
      "2026-10-31T00:00:00.000Z",
    )
  })

  it("treats the expiry instant as already expired", () => {
    expect(isExpired({ expiresAt: NOW }, NOW)).toBe(true)
    expect(isExpired({ expiresAt: AT("2026-09-01T12:00:01Z") }, NOW)).toBe(false)
  })
})

describe("first click with no prior attribution", () => {
  it("creates the attribution for either model", () => {
    for (const model of ["first_click", "last_click"] as const) {
      const decision = resolveAttribution({
        current: null,
        click: click("click_1", "pa_wendel"),
        model,
        windowDays: 60,
        now: NOW,
      })
      expect(decision.action).toBe("create")
      expect(decision.programAffiliateId).toBe("pa_wendel")
      expect(decision.firstClickId).toBe("click_1")
      expect(decision.lastClickId).toBe("click_1")
    }
  })
})

describe("last-click", () => {
  it("reassigns credit to the newest affiliate", () => {
    const decision = resolveAttribution({
      current: state(),
      click: click("click_2", "pa_joao"),
      model: "last_click",
      windowDays: 60,
      now: NOW,
    })
    expect(decision.action).toBe("replace")
    expect(decision.programAffiliateId).toBe("pa_joao")
    expect(decision.firstClickId).toBe("click_1")
    expect(decision.lastClickId).toBe("click_2")
  })

  it("restarts the window on every click", () => {
    const decision = resolveAttribution({
      current: state(),
      click: click("click_2", "pa_wendel", "2026-09-01T00:00:00Z"),
      model: "last_click",
      windowDays: 60,
      now: NOW,
    })
    expect(decision.action).toBe("touch")
    expect(decision.expiresAt.toISOString()).toBe("2026-10-31T00:00:00.000Z")
  })
})

describe("first-click", () => {
  it("keeps the original affiliate while the window is open", () => {
    const decision = resolveAttribution({
      current: state(),
      click: click("click_2", "pa_joao"),
      model: "first_click",
      windowDays: 60,
      now: NOW,
    })
    expect(decision.action).toBe("touch")
    expect(decision.programAffiliateId).toBe("pa_wendel")
    expect(decision.lastClickId).toBe("click_2")
    expect(decision.expiresAt.toISOString()).toBe(state().expiresAt.toISOString())
  })

  it("does not extend the window", () => {
    const decision = resolveAttribution({
      current: state(),
      click: click("click_2", "pa_wendel"),
      model: "first_click",
      windowDays: 60,
      now: NOW,
    })
    expect(decision.attributedAt.toISOString()).toBe("2026-08-01T00:00:00.000Z")
  })
})

describe("expiry", () => {
  it("lets a new click take over once the prior attribution lapsed", () => {
    const lapsed = state({ expiresAt: AT("2026-08-15T00:00:00Z") })
    for (const model of ["first_click", "last_click"] as const) {
      const decision = resolveAttribution({
        current: lapsed,
        click: click("click_9", "pa_maria"),
        model,
        windowDays: 60,
        now: NOW,
      })
      expect(decision.action).toBe("replace")
      expect(decision.programAffiliateId).toBe("pa_maria")
      expect(decision.firstClickId).toBe("click_9")
    }
  })

  it("rejects a conversion after the window closed", () => {
    expect(isAttributionValidAt({ expiresAt: AT("2026-08-01T00:00:00Z") }, NOW)).toBe(false)
    expect(isAttributionValidAt({ expiresAt: AT("2026-10-01T00:00:00Z") }, NOW)).toBe(true)
  })
})

describe("determinism", () => {
  it("returns the same decision for the same inputs", () => {
    const args = {
      current: state(),
      click: click("click_2", "pa_joao"),
      model: "last_click" as const,
      windowDays: 60,
      now: NOW,
    }
    expect(resolveAttribution(args)).toEqual(resolveAttribution(args))
  })
})
