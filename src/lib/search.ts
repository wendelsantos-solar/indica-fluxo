/**
 * The command palette's record search — the pure half. Kept free of I/O so the
 * rules a query goes through before it reaches SQL are unit-tested.
 */

/** Results per group (programs, affiliates, batches): a palette, not a list page. */
export const SEARCH_RESULT_LIMIT = 5
export const SEARCH_QUERY_MIN_LENGTH = 2
/** Longer input is cut, not rejected: a pasted paragraph still searches its start. */
export const SEARCH_QUERY_MAX_LENGTH = 80

/**
 * Turns what the reader typed into a case-insensitive `ILIKE` "contains"
 * pattern, or `null` when there is nothing worth searching for.
 *
 * `%` and `_` are wildcards and `\` is Postgres's default `LIKE` escape, so all
 * three are escaped: typing "50%" looks for the text "50%", not for anything
 * starting with "50". Runs of whitespace collapse to one space.
 */
export function toContainsPattern(query: string): string | null {
  const normalised = query.trim().replace(/\s+/g, " ").slice(0, SEARCH_QUERY_MAX_LENGTH).trim()
  if (normalised.length < SEARCH_QUERY_MIN_LENGTH) return null
  return `%${normalised.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}
