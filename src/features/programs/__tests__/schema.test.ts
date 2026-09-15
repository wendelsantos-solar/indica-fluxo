import { describe, expect, it } from "vitest"

import { parseProgramForm, toProgramInput } from "../schema"

function form(overrides: Record<string, string | null> = {}): FormData {
  const base: Record<string, string> = {
    workspaceSlug: "acme",
    name: "Partners",
    status: "active",
    commissionType: "percentage",
    commissionAmount: "30",
    recurrence: "months",
    durationMonths: "12",
    attributionModel: "last_click",
    attributionWindowDays: "60",
    commissionHoldDays: "30",
    currency: "USD",
    websiteUrl: "",
  }
  const data = new FormData()
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    if (value !== null) data.set(key, value)
  }
  return data
}

function fieldErrors(data: FormData) {
  const parsed = parseProgramForm(data)
  expect(parsed.success).toBe(false)
  return parsed.success ? {} : parsed.error.flatten().fieldErrors
}

describe("program form: recurrence (D6)", () => {
  it("rejects one month, which is exactly 'first payment only'", () => {
    expect(fieldErrors(form({ durationMonths: "1" })).durationMonths).toEqual(["durationMonthsRange"])
  })

  it("requires a duration when recurring for a number of months", () => {
    expect(fieldErrors(form({ durationMonths: "" })).durationMonths).toEqual(["durationMonthsRange"])
  })

  it("accepts two months and maps it through unchanged", () => {
    const parsed = parseProgramForm(form({ durationMonths: "2" }))
    expect(parsed.success && toProgramInput(parsed.data).commissionDurationMonths).toBe(2)
  })

  it("maps first-only to 1 and lifetime to null, ignoring a stale duration", () => {
    const first = parseProgramForm(form({ recurrence: "first_only", durationMonths: "1" }))
    const lifetime = parseProgramForm(form({ recurrence: "lifetime", durationMonths: "abc" }))
    expect(first.success && toProgramInput(first.data).commissionDurationMonths).toBe(1)
    expect(lifetime.success && toProgramInput(lifetime.data).commissionDurationMonths).toBeNull()
  })
})

describe("program form: website (F10)", () => {
  it("keeps the stored value when the field is not on the form", () => {
    const parsed = parseProgramForm(form({ websiteUrl: null }))
    expect(parsed.success && toProgramInput(parsed.data).websiteUrl).toBeUndefined()
  })

  it("clears the stored value when the field is submitted empty", () => {
    const parsed = parseProgramForm(form({ websiteUrl: "   " }))
    expect(parsed.success && toProgramInput(parsed.data).websiteUrl).toBeNull()
  })

  it("accepts an http(s) URL, trimmed", () => {
    const parsed = parseProgramForm(form({ websiteUrl: "  https://acme.com/app  " }))
    expect(parsed.success && toProgramInput(parsed.data).websiteUrl).toBe("https://acme.com/app")
  })

  it("rejects other schemes, bare hosts and overlong values", () => {
    expect(fieldErrors(form({ websiteUrl: "javascript:alert(1)" })).websiteUrl).toEqual([
      "websiteUrlInvalid",
    ])
    expect(fieldErrors(form({ websiteUrl: "acme.com" })).websiteUrl).toEqual(["websiteUrlInvalid"])
    expect(
      fieldErrors(form({ websiteUrl: `https://acme.com/${"a".repeat(2048)}` })).websiteUrl,
    ).toContain("websiteUrlTooLong")
  })
})

describe("program form: commission", () => {
  it("converts percent to basis points", () => {
    const parsed = parseProgramForm(form({ commissionAmount: "25.5" }))
    expect(parsed.success && toProgramInput(parsed.data).commissionValue).toBe(2550)
  })

  it("rejects a percentage over 100", () => {
    expect(fieldErrors(form({ commissionAmount: "101" })).commissionAmount).toEqual([
      "percentageOver100",
    ])
  })
})
