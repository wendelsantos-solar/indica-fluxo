import { describe, expect, it } from "vitest"

import {
  nextSort,
  pageWindow,
  parsePage,
  parsePeriod,
  parseSearch,
  parseSort,
  parseUuidParam,
  periodStart,
} from "../list-params"

const config = {
  fields: ["name", "joined", "revenue"] as const,
  defaultSort: { field: "joined", dir: "desc" } as const,
  naturalDir: { name: "asc" } as const,
}

describe("parseSort", () => {
  it("falls back to the default for a missing or unknown field", () => {
    expect(parseSort({}, config)).toEqual({ field: "joined", dir: "desc" })
    expect(parseSort({ sort: "password", dir: "asc" }, config)).toEqual({ field: "joined", dir: "desc" })
    expect(parseSort({ sort: "name; drop table", dir: "asc" }, config)).toEqual({
      field: "joined",
      dir: "desc",
    })
  })

  it("accepts a whitelisted field and direction", () => {
    expect(parseSort({ sort: "revenue", dir: "asc" }, config)).toEqual({ field: "revenue", dir: "asc" })
  })

  it("uses the field's natural direction when dir is missing or invalid", () => {
    expect(parseSort({ sort: "name" }, config)).toEqual({ field: "name", dir: "asc" })
    expect(parseSort({ sort: "revenue", dir: "sideways" }, config)).toEqual({
      field: "revenue",
      dir: "desc",
    })
  })

  it("reads the first value of a repeated param", () => {
    expect(parseSort({ sort: ["name", "joined"], dir: ["desc"] }, config)).toEqual({
      field: "name",
      dir: "desc",
    })
  })
})

describe("nextSort", () => {
  it("flips the direction of the active column", () => {
    expect(nextSort({ field: "name", dir: "asc" }, "name")).toEqual({ field: "name", dir: "desc" })
    expect(nextSort({ field: "name", dir: "desc" }, "name")).toEqual({ field: "name", dir: "asc" })
  })

  it("starts another column at its natural direction", () => {
    expect(nextSort({ field: "name", dir: "asc" }, "revenue")).toEqual({ field: "revenue", dir: "desc" })
    expect(nextSort({ field: "revenue", dir: "desc" }, "name", "asc")).toEqual({ field: "name", dir: "asc" })
  })
})

describe("parsePage", () => {
  it("rounds down fractional pages and clamps to 1", () => {
    expect(parsePage("2.5")).toBe(2)
    expect(parsePage("0")).toBe(1)
    expect(parsePage("-3")).toBe(1)
    expect(parsePage("abc")).toBe(1)
    expect(parsePage(undefined)).toBe(1)
    expect(parsePage("Infinity")).toBe(1)
  })

  it("keeps a valid page", () => {
    expect(parsePage("7")).toBe(7)
    expect(parsePage(["3", "9"])).toBe(3)
  })
})

describe("pageWindow", () => {
  it("computes pages and offset", () => {
    expect(pageWindow(2, 60, 25)).toEqual({ page: 2, pages: 3, offset: 25, pastEnd: false })
  })

  it("flags a page after the last one", () => {
    expect(pageWindow(5, 60, 25).pastEnd).toBe(true)
  })

  it("never flags an empty list as past the end", () => {
    expect(pageWindow(3, 0, 25)).toEqual({ page: 3, pages: 1, offset: 50, pastEnd: false })
  })
})

describe("parseUuidParam", () => {
  it("accepts only UUIDs", () => {
    expect(parseUuidParam("3f2a9c1b-1234-4abc-8def-0123456789ab")).toBe(
      "3f2a9c1b-1234-4abc-8def-0123456789ab",
    )
    expect(parseUuidParam("1 or 1=1")).toBeUndefined()
    expect(parseUuidParam(undefined)).toBeUndefined()
  })
})

describe("parsePeriod / periodStart", () => {
  it("accepts known periods only", () => {
    expect(parsePeriod("30d")).toBe("30d")
    expect(parsePeriod("5y")).toBeUndefined()
  })

  it("counts back from now in UTC", () => {
    const now = new Date("2026-09-14T12:00:00Z")
    expect(periodStart("7d", now).toISOString()).toBe("2026-09-07T12:00:00.000Z")
    expect(periodStart("12m", now).toISOString()).toBe("2025-09-14T12:00:00.000Z")
  })
})

describe("parseSearch", () => {
  it("trims, caps and drops blanks", () => {
    expect(parseSearch("  ana  ")).toBe("ana")
    expect(parseSearch("   ")).toBeUndefined()
    expect(parseSearch("x".repeat(300))?.length).toBe(100)
  })
})
