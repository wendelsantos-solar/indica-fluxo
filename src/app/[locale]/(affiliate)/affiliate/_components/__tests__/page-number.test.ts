import { describe, expect, it } from "vitest"

import { pageNumber } from "../page-number"

describe("pageNumber", () => {
  it("reads a positive integer", () => {
    expect(pageNumber("3")).toBe(3)
    expect(pageNumber(["2", "9"])).toBe(2)
  })

  it("falls back to page 1 for anything else", () => {
    for (const value of [undefined, "", "0", "-3", "2.5", "abc", "1e3x", []]) {
      expect(pageNumber(value as string | string[] | undefined)).toBe(1)
    }
  })
})
