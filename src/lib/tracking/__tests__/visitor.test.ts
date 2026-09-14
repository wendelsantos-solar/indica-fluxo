import { describe, expect, it } from "vitest"

import {
  buildReferralUrl,
  classifyDevice,
  generateVisitorId,
  isValidVisitorId,
  normalizeReferralCode,
  sanitizeUrl,
} from "../visitor"

describe("visitor ids", () => {
  it("generates ids that pass its own validator", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(isValidVisitorId(generateVisitorId())).toBe(true)
    }
  })

  it("rejects anything it did not mint", () => {
    for (const bad of ["", "abc", "v_", "v_ABC123456789012345678", "<script>", null]) {
      expect(isValidVisitorId(bad)).toBe(false)
    }
  })
})

describe("referral codes", () => {
  it("lowercases and accepts valid codes", () => {
    expect(normalizeReferralCode("Wendel")).toBe("wendel")
    expect(normalizeReferralCode("agency-xyz_1")).toBe("agency-xyz_1")
  })

  it("rejects injection-shaped input", () => {
    for (const bad of ["", "-lead", "a", "wendel!", "' OR 1=1--", "a".repeat(60)]) {
      expect(normalizeReferralCode(bad)).toBeNull()
    }
  })
})

describe("url sanitisation", () => {
  it("strips credentials and fragments", () => {
    expect(sanitizeUrl("https://user:pw@acme.com/pricing#top")).toBe("https://acme.com/pricing")
  })

  it("rejects non-http schemes", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBeNull()
    expect(sanitizeUrl("data:text/html,<script>")).toBeNull()
    expect(sanitizeUrl("not a url")).toBeNull()
  })
})

describe("device classification", () => {
  it("buckets the common families", () => {
    expect(classifyDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148")).toBe("mobile")
    expect(classifyDevice("Mozilla/5.0 (iPad; CPU OS 17_0)")).toBe("tablet")
    expect(classifyDevice("Mozilla/5.0 (Macintosh) Chrome/120")).toBe("desktop")
    expect(classifyDevice(null)).toBe("unknown")
  })
})

describe("referral urls", () => {
  it("appends the ref parameter", () => {
    expect(buildReferralUrl("https://acme.com", "wendel")).toBe("https://acme.com/?ref=wendel")
  })

  it("replaces an existing ref rather than duplicating it", () => {
    expect(buildReferralUrl("https://acme.com/?ref=old&a=1", "new")).toBe(
      "https://acme.com/?ref=new&a=1",
    )
  })
})
