/**
 * The public attribution reference: the only value that may leave Refvia
 * and travel through a payment provider.
 *
 * Framework- and crypto-free on purpose, so the tracker script, the Stripe
 * adapter, the documentation snippets and the tests all share one definition of
 * what a token looks like. Minting lives in `src/lib/crypto/hash.ts`
 * (`generateAttributionToken`), which is `server-only`.
 *
 * The alphabet is not a style choice. Stripe Payment Links accept a
 * `client_reference_id` of alphanumerics, `-` and `_` only, up to 200
 * characters, and **silently drop** anything else — so base64url is the widest
 * encoding that survives the transport (INTEGRATION_ARCHITECTURE_AUDIT.md §5).
 */

export const ATTRIBUTION_TOKEN_PREFIX = "ifx_"

/** `ifx_` + 43 base64url characters (32 random bytes). */
export const ATTRIBUTION_TOKEN_PATTERN = /^ifx_[A-Za-z0-9_-]{22,64}$/

/**
 * The metadata key a custom checkout carries the token under
 * (`payment_intent_data[metadata][indicafluxo_ref]`, subscription metadata).
 * 15 characters, well inside Stripe's 40-character key limit.
 */
export const ATTRIBUTION_METADATA_KEY = "indicafluxo_ref"

/**
 * The metadata key a server-created checkout carries the SaaS's own customer id
 * under (`metadata[indicafluxo_customer]`). Only ever read from server-set
 * metadata — never from `client_reference_id`, an external reference or a URL,
 * which a browser can set (UNIVERSAL_ATTRIBUTION_ARCHITECTURE.md §4).
 */
export const CUSTOMER_METADATA_KEY = "indicafluxo_customer"

/** Longest external customer id accepted, the same bound as `POST /api/identify`. */
export const EXTERNAL_CUSTOMER_ID_MAX = 200

/** The SaaS's customer id in a provider `metadata` map, or `null`. */
export function readExternalCustomerIdFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  const value = metadata?.[CUSTOMER_METADATA_KEY]
  if (typeof value !== "string" && typeof value !== "number") return null
  const trimmed = String(value).trim()
  return trimmed && trimmed.length <= EXTERNAL_CUSTOMER_ID_MAX ? trimmed : null
}

/** The cookie the tracker keeps the token in, on the founder's own domain. */
export const ATTRIBUTION_TOKEN_COOKIE = "_referral_ref"

/** Shape check only — it says nothing about whether the token exists or is still valid. */
export function isAttributionToken(value: unknown): value is string {
  return typeof value === "string" && ATTRIBUTION_TOKEN_PATTERN.test(value)
}

/**
 * The token inside a value that may be one, or `null`. Used on every provider
 * field a founder could put something else in: `client_reference_id` is also a
 * legitimate place for their own cart id, and a value that is not ours is not
 * an error — it simply carries no attribution.
 */
export function readAttributionToken(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return isAttributionToken(trimmed) ? trimmed : null
}

/**
 * The first token found in a provider `metadata` map, under our key. Stripe
 * metadata values are always strings, but a payload is untrusted input.
 */
export function readAttributionTokenFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  if (!metadata) return null
  return readAttributionToken(metadata[ATTRIBUTION_METADATA_KEY])
}

/** Displayable stem kept for diagnostics: `ifx_qN7dR2`. Never enough to use. */
export function attributionTokenPrefix(token: string): string {
  return token.slice(0, ATTRIBUTION_TOKEN_PREFIX.length + 6)
}
