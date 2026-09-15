/**
 * A `?page=` search param as a 1-based page number. Anything that is not a
 * positive integer — missing, repeated, `abc`, `-3`, `2.5` — is page 1.
 */
export function pageNumber(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value
  const page = Number(raw)
  return Number.isSafeInteger(page) && page >= 1 ? page : 1
}
