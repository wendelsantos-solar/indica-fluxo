import { describe, expect, it } from "vitest"

import { batchOrdinal, formatBatchLabel } from "../batch-label"

const SEPT_END = new Date(Date.UTC(2026, 8, 30))

describe("formatBatchLabel", () => {
  it("names the batch month in the reader's language, not the stored English", () => {
    expect(formatBatchLabel("pt-BR", SEPT_END, "September 2026")).toBe("Setembro de 2026")
    expect(formatBatchLabel("en", SEPT_END, "September 2026")).toBe("September 2026")
  })

  it("keeps the stored ordinal of a second batch in the month", () => {
    expect(formatBatchLabel("pt-BR", SEPT_END, "September 2026 #2")).toBe("Setembro de 2026 #2")
  })

  it("reads the month in UTC, the zone the reference was computed in", () => {
    // 1 October 00:30 UTC is still 30 September in São Paulo; the batch is October's.
    expect(formatBatchLabel("pt-BR", new Date(Date.UTC(2026, 9, 1, 0, 30)), "October 2026")).toBe("Outubro de 2026")
  })

  it("falls back to the stored reference for an invalid date", () => {
    expect(formatBatchLabel("pt-BR", new Date("nope"), "September 2026")).toBe("September 2026")
  })
})

describe("batchOrdinal", () => {
  it("reads only a trailing ordinal above one", () => {
    expect(batchOrdinal("September 2026")).toBeNull()
    expect(batchOrdinal("September 2026 #2")).toBe(2)
    expect(batchOrdinal("September 2026 #12")).toBe(12)
    expect(batchOrdinal("#2 September 2026")).toBeNull()
  })
})
