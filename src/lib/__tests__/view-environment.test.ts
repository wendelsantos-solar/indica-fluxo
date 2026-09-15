import { describe, expect, it } from "vitest"

import { parseViewEnvironment, resolveViewEnvironment, viewEnvironmentCookie } from "@/lib/view-environment"

describe("resolveViewEnvironment", () => {
  it("keeps a Sandbox workspace on test, whatever was requested", () => {
    for (const requested of ["live", "test", undefined, "garbage"]) {
      expect(resolveViewEnvironment({ requested, liveModeAvailable: false, hasLivePrograms: false })).toEqual({
        environment: "test",
        switchable: false,
      })
    }
  })

  it("defaults to live when live mode is included", () => {
    expect(resolveViewEnvironment({ requested: undefined, liveModeAvailable: true, hasLivePrograms: false })).toEqual({
      environment: "live",
      switchable: true,
    })
    expect(resolveViewEnvironment({ requested: "nope", liveModeAvailable: true, hasLivePrograms: true })).toEqual({
      environment: "live",
      switchable: true,
    })
  })

  it("honours the reader's choice when live mode is included", () => {
    expect(resolveViewEnvironment({ requested: "test", liveModeAvailable: true, hasLivePrograms: true }).environment).toBe(
      "test",
    )
    expect(resolveViewEnvironment({ requested: "live", liveModeAvailable: true, hasLivePrograms: false }).environment).toBe(
      "live",
    )
  })

  it("keeps live data readable after a downgrade", () => {
    expect(resolveViewEnvironment({ requested: undefined, liveModeAvailable: false, hasLivePrograms: true })).toEqual({
      environment: "live",
      switchable: true,
    })
    expect(resolveViewEnvironment({ requested: "test", liveModeAvailable: false, hasLivePrograms: true }).environment).toBe(
      "test",
    )
  })
})

describe("view environment cookie", () => {
  it("is per workspace", () => {
    expect(viewEnvironmentCookie("abc")).toBe("if_env_abc")
  })

  it("parses only the two environments", () => {
    expect(parseViewEnvironment("live")).toBe("live")
    expect(parseViewEnvironment("test")).toBe("test")
    expect(parseViewEnvironment("LIVE")).toBeNull()
    expect(parseViewEnvironment(undefined)).toBeNull()
  })
})
