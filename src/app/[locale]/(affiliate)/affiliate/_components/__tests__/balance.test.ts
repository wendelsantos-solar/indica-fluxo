import { describe, expect, it } from "vitest"

import { nextReleaseDate, receivable } from "../balance"

const now = new Date("2026-09-14T12:00:00Z")

describe("nextReleaseDate", () => {
  it("returns the earliest date still in the future", () => {
    expect(
      nextReleaseDate(
        [new Date("2026-10-01T00:00:00Z"), null, new Date("2026-09-20T00:00:00Z")],
        now,
      ),
    ).toEqual(new Date("2026-09-20T00:00:00Z"))
  })

  it("ignores dates already reached — those commissions are available", () => {
    expect(nextReleaseDate([new Date("2026-09-14T12:00:00Z"), new Date("2026-09-01T00:00:00Z")], now)).toBeNull()
  })

  it("is null when nothing is on hold", () => {
    expect(nextReleaseDate([], now)).toBeNull()
    expect(nextReleaseDate([null, null], now)).toBeNull()
  })
})

describe("receivable", () => {
  it("splits the unpaid balance per currency and adds the parts into the total", () => {
    const result = receivable(
      [
        { currency: "BRL", holdMinor: 3000, availableMinor: 5000, approvedMinor: 0, nextReleaseAt: new Date("2026-09-30T00:00:00Z") },
        { currency: "brl", holdMinor: 1000, availableMinor: 0, approvedMinor: 2000, nextReleaseAt: new Date("2026-09-21T00:00:00Z") },
        { currency: "USD", holdMinor: 0, availableMinor: 700, approvedMinor: 0, nextReleaseAt: null },
      ],
      now,
    )

    expect(result.total).toEqual([
      { currency: "BRL", amountMinor: 11000 },
      { currency: "USD", amountMinor: 700 },
    ])
    expect(result.available).toEqual([
      { currency: "BRL", amountMinor: 5000 },
      { currency: "USD", amountMinor: 700 },
    ])
    expect(result.hold).toEqual([
      { currency: "BRL", amountMinor: 4000 },
      { currency: "USD", amountMinor: 0 },
    ])
    expect(result.approved).toEqual([
      { currency: "BRL", amountMinor: 2000 },
      { currency: "USD", amountMinor: 0 },
    ])
    expect(result.nextReleaseAt).toEqual(new Date("2026-09-21T00:00:00Z"))
  })

  it("has no next release when nothing earning is on hold", () => {
    const result = receivable(
      [{ currency: "BRL", holdMinor: 0, availableMinor: 100, approvedMinor: 0, nextReleaseAt: new Date("2026-12-01T00:00:00Z") }],
      now,
    )
    expect(result.nextReleaseAt).toBeNull()
  })
})
