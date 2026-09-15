import { describe, expect, it } from "vitest"

import { periodStartInZone } from "../list-params"
import {
  addCalendarDays,
  isSupportedTimeZone,
  localDateKey,
  localDayRange,
  localMonthPeriod,
  resolveTimeZone,
  startOfDayIn,
} from "../time-zone"

describe("resolveTimeZone", () => {
  it("keeps supported IANA zones, UTC included", () => {
    expect(resolveTimeZone("America/Sao_Paulo")).toBe("America/Sao_Paulo")
    expect(resolveTimeZone("UTC")).toBe("UTC")
    expect(isSupportedTimeZone("Europe/Lisbon")).toBe(true)
  })

  it("falls back to UTC for anything else, so nothing unknown reaches SQL", () => {
    expect(resolveTimeZone(null)).toBe("UTC")
    expect(resolveTimeZone("")).toBe("UTC")
    expect(resolveTimeZone("Mars/Olympus_Mons")).toBe("UTC")
    expect(resolveTimeZone("UTC'; drop table commissions; --")).toBe("UTC")
  })
})

describe("localDateKey", () => {
  it("puts a 22:00 São Paulo payment on its local day, not UTC's next one", () => {
    const instant = new Date("2026-09-15T01:00:00Z") // 22:00 on 14 Sep in São Paulo
    expect(localDateKey(instant, "UTC")).toBe("2026-09-15")
    expect(localDateKey(instant, "America/Sao_Paulo")).toBe("2026-09-14")
  })
})

describe("addCalendarDays", () => {
  it("crosses month and year ends", () => {
    expect(addCalendarDays({ year: 2026, month: 1, day: 31 }, 1)).toEqual({ year: 2026, month: 2, day: 1 })
    expect(addCalendarDays({ year: 2026, month: 1, day: 1 }, -1)).toEqual({ year: 2025, month: 12, day: 31 })
    expect(addCalendarDays({ year: 2028, month: 2, day: 28 }, 1)).toEqual({ year: 2028, month: 2, day: 29 })
  })
})

describe("startOfDayIn", () => {
  it("is local midnight as an instant", () => {
    expect(startOfDayIn({ year: 2026, month: 9, day: 14 }, "America/Sao_Paulo").toISOString()).toBe(
      "2026-09-14T03:00:00.000Z",
    )
    expect(startOfDayIn({ year: 2026, month: 9, day: 14 }, "Australia/Sydney").toISOString()).toBe(
      "2026-09-13T14:00:00.000Z",
    )
    expect(startOfDayIn({ year: 2026, month: 9, day: 14 }, "UTC").toISOString()).toBe("2026-09-14T00:00:00.000Z")
  })

  it("follows the offset on DST days", () => {
    // New York moves to EDT on 8 March 2026; midnight is still EST.
    expect(startOfDayIn({ year: 2026, month: 3, day: 8 }, "America/New_York").toISOString()).toBe(
      "2026-03-08T05:00:00.000Z",
    )
    expect(startOfDayIn({ year: 2026, month: 3, day: 9 }, "America/New_York").toISOString()).toBe(
      "2026-03-09T04:00:00.000Z",
    )
  })

  it("starts at the first valid time when a DST jump skips midnight", () => {
    // São Paulo jumped from 00:00 to 01:00 on 4 November 2018.
    expect(startOfDayIn({ year: 2018, month: 11, day: 4 }, "America/Sao_Paulo").toISOString()).toBe(
      "2018-11-04T03:00:00.000Z",
    )
  })
})

describe("localDayRange", () => {
  it("covers today and the days before it, from local midnight", () => {
    const now = new Date("2026-09-15T01:00:00Z") // 14 Sep, 22:00 in São Paulo
    const range = localDayRange(now, "America/Sao_Paulo", 30)

    expect(range.keys).toHaveLength(30)
    expect(range.keys[0]).toBe("2026-08-16")
    expect(range.keys[29]).toBe("2026-09-14")
    expect(range.start.toISOString()).toBe("2026-08-16T03:00:00.000Z")
    expect(range.previousStart.toISOString()).toBe("2026-07-17T03:00:00.000Z")
  })

  it("differs from UTC's window around midnight", () => {
    const now = new Date("2026-09-15T01:00:00Z")
    const utc = localDayRange(now, "UTC", 7)
    expect(utc.keys.at(-1)).toBe("2026-09-15")
    expect(utc.start.toISOString()).toBe("2026-09-09T00:00:00.000Z")
  })

  it("never returns an empty window", () => {
    expect(localDayRange(new Date("2026-09-14T12:00:00Z"), "UTC", 0).keys).toEqual(["2026-09-14"])
  })
})

describe("localMonthPeriod", () => {
  it("picks the workspace's month, stored as UTC calendar dates", () => {
    // 31 Aug, 22:00 in São Paulo — already September in UTC.
    const now = new Date("2026-09-01T01:00:00Z")
    const local = localMonthPeriod(now, "America/Sao_Paulo")
    expect(local.periodStart.toISOString()).toBe("2026-08-01T00:00:00.000Z")
    expect(local.periodEnd.toISOString()).toBe("2026-08-31T00:00:00.000Z")

    const utc = localMonthPeriod(now, "UTC")
    expect(utc.periodStart.toISOString()).toBe("2026-09-01T00:00:00.000Z")
    expect(utc.periodEnd.toISOString()).toBe("2026-09-30T00:00:00.000Z")
  })
})

describe("periodStartInZone", () => {
  const now = new Date("2026-09-15T01:00:00Z") // 14 Sep, 22:00 in São Paulo

  it("counts calendar days in the workspace zone", () => {
    expect(periodStartInZone("7d", now, "America/Sao_Paulo").toISOString()).toBe("2026-09-08T03:00:00.000Z")
    expect(periodStartInZone("30d", now, "UTC").toISOString()).toBe("2026-08-17T00:00:00.000Z")
  })

  it("starts twelve months back the day after the same date", () => {
    expect(periodStartInZone("12m", now, "America/Sao_Paulo").toISOString()).toBe("2025-09-15T03:00:00.000Z")
  })
})
