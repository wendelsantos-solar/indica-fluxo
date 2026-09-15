import type { core } from "zod"

/**
 * Zod's built-in messages are English sentences ("Too small: expected string
 * to have >=2 characters"). Schemas in this codebase set catalogue keys for
 * the messages they care about; everything else falls back to Zod's text and
 * used to reach the page untranslated.
 *
 * This maps an issue to a catalogue key under `errors.fields.generic.*` plus
 * the values it needs, from the issue's structured data rather than its text,
 * so every locale gets a sentence. Pure: no next-intl import, unit-tested.
 */
export interface IssueMessage {
  key: string
  values?: Record<string, number | string>
}

export function describeIssue(issue: core.$ZodIssue): IssueMessage {
  switch (issue.code) {
    case "too_small": {
      const min = Number(issue.minimum)
      if (issue.origin === "string") return min <= 1 ? { key: "required" } : { key: "minLength", values: { min } }
      if (issue.origin === "array" || issue.origin === "set") return { key: "minItems", values: { min } }
      return { key: "minNumber", values: { min } }
    }
    case "too_big": {
      const max = Number(issue.maximum)
      if (issue.origin === "string") return { key: "maxLength", values: { max } }
      if (issue.origin === "array" || issue.origin === "set") return { key: "maxItems", values: { max } }
      return { key: "maxNumber", values: { max } }
    }
    case "invalid_format":
      if (issue.format === "email") return { key: "email" }
      if (issue.format === "url") return { key: "url" }
      if (issue.format === "uuid") return { key: "invalid" }
      return { key: "format" }
    case "invalid_type":
      // Form data only ever carries strings, so a string field of the wrong
      // type was not sent at all; a number field got something non-numeric.
      if (issue.expected === "string") return { key: "required" }
      if (issue.expected === "number" || issue.expected === "int") return { key: "number" }
      return { key: "invalid" }
    case "not_multiple_of":
      return { key: "number" }
    case "invalid_value":
      return { key: "choice" }
    default:
      return { key: "invalid" }
  }
}
