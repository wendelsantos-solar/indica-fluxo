import "server-only"

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

import { env } from "@/lib/env/server"

const ALGORITHM = "aes-256-gcm"
const IV_BYTES = 12

function key(): Buffer {
  const raw = Buffer.from(env().ENCRYPTION_KEY, "base64")
  if (raw.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes (base64 of 32 random bytes).")
  }
  return raw
}

/**
 * AES-256-GCM. Output format: `v1.<iv>.<authTag>.<ciphertext>`, all base64url.
 * Used for provider credentials we are forced to hold; prefer OAuth account ids.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()

  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".")
}

export function decryptSecret(payload: string): string {
  const [version, ivPart, tagPart, dataPart] = payload.split(".")
  if (version !== "v1" || !ivPart || !tagPart || !dataPart) {
    throw new Error("Malformed encrypted payload.")
  }

  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivPart, "base64url"))
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"))

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]).toString("utf8")
}
