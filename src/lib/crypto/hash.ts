import "server-only"

import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import { env } from "@/lib/env/server"

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

export interface GeneratedApiKey {
  /** Shown to the user exactly once. */
  plaintext: string
  /** Stored for display: `sk_live_a1b2c3d4`. */
  prefix: string
  /** Stored for verification. */
  hash: string
}

/**
 * `pk_live_…` / `sk_live_…`. 32 random bytes, base64url encoded.
 * Only the hash is persisted; the plaintext is returned once and never again.
 */
export function generateApiKey(type: ApiKeyType, live = true): GeneratedApiKey {
  const scope = type === "secret" ? "sk" : "pk"
  const mode = live ? "live" : "test"
  const secret = randomBytes(24).toString("base64url")
  const plaintext = `${scope}_${mode}_${secret}`

  return {
    plaintext,
    prefix: `${scope}_${mode}_${secret.slice(0, 6)}`,
    hash: peppered(plaintext),
  }
}

/** Constant-time comparison of two hex digests. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8")
  const bufB = Buffer.from(b, "utf8")
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
