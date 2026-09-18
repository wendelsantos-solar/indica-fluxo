import "server-only"

import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import { env } from "@/lib/env/server"
import { ATTRIBUTION_TOKEN_PREFIX, attributionTokenPrefix } from "@/lib/tracking/attribution-token"

/** Peppered SHA-256. Used for API keys, e-mail matching and IP hashing. */
export function peppered(value: string): string {
  return createHash("sha256").update(`${value}${env().HASH_PEPPER}`).digest("hex")
}

export function hashEmail(email: string): string {
  return peppered(`email:${email.trim().toLowerCase()}`)
}

export function hashIp(ip: string): string {
  return peppered(`ip:${ip}`)
}

export function hashPayload(payload: string): string {
  return createHash("sha256").update(payload).digest("hex")
}

export type ApiKeyType = "publishable" | "secret"
export type ApiKeyEnvironment = "test" | "live"

export interface GeneratedApiKey {
  /** Shown to the user exactly once. */
  plaintext: string
  /** Stored for display: `sk_live_a1b2c3`. */
  prefix: string
  /** Stored for verification. */
  hash: string
}

/** `pk_test_…`, `sk_live_…`: the scope and the environment a presented key claims. */
export const API_KEY_PATTERN = /^(pk|sk)_(live|test)_[A-Za-z0-9_-]{10,}$/

/**
 * `pk_test_…` / `sk_test_…` reach test programs only; `pk_live_…` /
 * `sk_live_…` live programs only (docs/PLANS.md §2). 24 random bytes,
 * base64url encoded. Only the hash is persisted; the plaintext is returned
 * once and never again.
 */
export function generateApiKey(type: ApiKeyType, environment: ApiKeyEnvironment): GeneratedApiKey {
  const scope = type === "secret" ? "sk" : "pk"
  const secret = randomBytes(24).toString("base64url")
  const plaintext = `${scope}_${environment}_${secret}`

  return {
    plaintext,
    prefix: `${scope}_${environment}_${secret.slice(0, 6)}`,
    hash: peppered(plaintext),
  }
}

/** The environment a well-formed key names in its prefix, or `null` for a malformed one. */
export function apiKeyEnvironment(presented: string): ApiKeyEnvironment | null {
  const match = API_KEY_PATTERN.exec(presented)
  return match ? (match[2] as ApiKeyEnvironment) : null
}

/** Constant-time comparison of two hex digests. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8")
  const bufB = Buffer.from(b, "utf8")
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * A public attribution reference. 32 random bytes, base64url encoded behind
 * `ifx_`, so the whole value survives Stripe's `client_reference_id` alphabet
 * (INTEGRATION_ARCHITECTURE_V2.md §2). Only the peppered hash is persisted; the
 * plaintext is returned once, to the tracker, and never stored.
 */
export function generateAttributionToken(): { plaintext: string; prefix: string; hash: string } {
  const plaintext = `${ATTRIBUTION_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`
  return { plaintext, prefix: attributionTokenPrefix(plaintext), hash: peppered(plaintext) }
}
