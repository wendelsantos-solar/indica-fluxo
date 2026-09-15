import { describe, expect, it } from "vitest"

import { commissionFilterQuery, parseCommissionFilters } from "../commission-filters-params"

const programs = ["11111111-1111-4111-8111-111111111111"]

describe("parseCommissionFilters", () => {
  it("keeps a known status and an own program", () => {
    expect(parseCommissionFilters({ status: "available", program: programs[0] }, programs)).toEqual({
      status: "available",
      programId: programs[0],
    })
  })

  it("drops unknown statuses and programs the affiliate is not part of", () => {
    expect(
      parseCommissionFilters({ status: "stolen", program: "22222222-2222-4222-8222-222222222222" }, programs),
    ).toEqual({ status: undefined, programId: undefined })
  })

  it("reads the first of repeated params", () => {
    expect(parseCommissionFilters({ status: ["paid", "pending"] }, programs).status).toBe("paid")
  })
})

describe("commissionFilterQuery", () => {
  it("omits empty filters and page 1", () => {
    expect(commissionFilterQuery({}, 1)).toEqual({})
    expect(commissionFilterQuery({ status: "paid" }, 3)).toEqual({ status: "paid", page: "3" })
  })
})
