import { describe, expect, it } from "vitest"

import { safeRedirectPath } from "../safe-redirect"

const FALLBACK = "/app"

describe("safeRedirectPath", () => {
  it("keeps a same-origin, locale-prefixed path with its query and hash", () => {
    expect(safeRedirectPath("/pt-br/app", FALLBACK)).toBe("/pt-br/app")
    expect(safeRedirectPath("/en/acme/commissions?page=2#top", FALLBACK)).toBe(
      "/en/acme/commissions?page=2#top",
    )
  })

  it.each([
    ["missing", null],
    ["not a string", 42],
    ["empty", ""],
    ["relative without slash", "pt-br/app"],
    ["absolute URL", "https://evil.test/app"],
    ["protocol-relative", "//evil.test"],
    ["backslash trick", "/\\evil.test"],
    ["tab-smuggled protocol-relative", "/\t/evil.test"],
    ["newline", "/pt-br/app\n"],
    ["javascript scheme", "javascript:alert(1)"],
  ])("falls back when the path is %s", (_label, candidate) => {
    expect(safeRedirectPath(candidate, FALLBACK)).toBe(FALLBACK)
  })
})
