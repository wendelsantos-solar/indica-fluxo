import { describe, expect, it } from "vitest"
import { z } from "zod"

import { describeIssue } from "../zod-issues"

function issueOf(schema: z.ZodType, input: unknown) {
  const result = schema.safeParse(input)
  if (result.success) throw new Error("expected a failure")
  return describeIssue(result.error.issues[0]!)
}

describe("describeIssue", () => {
  it("maps string length bounds with their values", () => {
    expect(issueOf(z.string().min(3), "ab")).toEqual({ key: "minLength", values: { min: 3 } })
    expect(issueOf(z.string().max(5), "abcdefg")).toEqual({ key: "maxLength", values: { max: 5 } })
  })

  it("treats a one-character minimum and a missing value as required", () => {
    expect(issueOf(z.string().min(1), "")).toEqual({ key: "required" })
    expect(issueOf(z.object({ name: z.string() }), {})).toEqual({ key: "required" })
  })

  it("maps numeric bounds and non-numbers", () => {
    expect(issueOf(z.coerce.number().min(1), "0")).toEqual({ key: "minNumber", values: { min: 1 } })
    expect(issueOf(z.coerce.number().max(365), "400")).toEqual({ key: "maxNumber", values: { max: 365 } })
    expect(issueOf(z.number(), "x")).toEqual({ key: "number" })
  })

  it("maps formats and enums", () => {
    expect(issueOf(z.string().email(), "nope")).toEqual({ key: "email" })
    expect(issueOf(z.string().url(), "nope")).toEqual({ key: "url" })
    expect(issueOf(z.enum(["a", "b"]), "c")).toEqual({ key: "choice" })
  })
})
