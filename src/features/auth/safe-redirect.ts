/**
 * Returns `candidate` only when it is a same-origin relative path, else
 * `fallback`.
 *
 * `?next=` arrives from the query string, so it is attacker-controlled: an
 * absolute URL, a protocol-relative `//evil.test`, or a browser-normalised
 * `/\evil.test` would turn sign-in into an open redirect. Anything that does
 * not resolve to our own origin is dropped rather than repaired.
 */
export function safeRedirectPath(candidate: unknown, fallback: string): string {
  if (typeof candidate !== "string" || candidate.length === 0) return fallback
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return fallback
  if (candidate.includes("\\")) return fallback

  // The URL parser silently strips tabs and newlines, which is how `/\t/x`
  // becomes `//x`. Refuse control characters outright.
  for (let i = 0; i < candidate.length; i++) {
    const code = candidate.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return fallback
  }

  const base = "http://same-origin.invalid"
  try {
    const url = new URL(candidate, base)
    if (url.origin !== base) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}
