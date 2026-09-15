import { describe, expect, it } from "vitest"

import { SEARCH_QUERY_MAX_LENGTH, toContainsPattern } from "@/lib/search"

describe("toContainsPattern", () => {
  it("wraps the query as a contains pattern", () => {
    expect(toContainsPattern("acme")).toBe("%acme%")
  })

  it("ignores queries shorter than two characters after trimming", () => {
    expect(toContainsPattern("")).toBeNull()
    expect(toContainsPattern("   ")).toBeNull()
    expect(toContainsPattern(" a ")).toBeNull()
  })

  it("collapses whitespace", () => {
    expect(toContainsPattern("  Marina   Souza ")).toBe("%Marina Souza%")
  })

  it("escapes LIKE wildcards and the escape character", () => {
    expect(toContainsPattern("50%_off")).toBe("%50\\%\\_off%")
    expect(toContainsPattern("a\\b")).toBe("%a\\\\b%")
  })

  it("cuts overly long input instead of rejecting it", () => {
    const pattern = toContainsPattern("x".repeat(500))
    expect(pattern).toBe(`%${"x".repeat(SEARCH_QUERY_MAX_LENGTH)}%`)
  })
})
