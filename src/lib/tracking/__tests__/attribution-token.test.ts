import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/env/server", () => ({ env: () => ({ HASH_PEPPER: "test-pepper" }) }))

import {
  ATTRIBUTION_METADATA_KEY,
  ATTRIBUTION_TOKEN_PREFIX,
  attributionTokenPrefix,
  isAttributionToken,
  readAttributionToken,
  readAttributionTokenFromMetadata,
} from "../attribution-token"

const { generateAttributionToken } = await import("@/lib/crypto/hash")

/**
 * The transport constraints are not style: Stripe Payment Links accept a
 * `client_reference_id` of alphanumerics, `-` and `_` only, up to 200
 * characters, and silently drop anything else — a token that fails this test
 * would be lost on the way to the checkout with no error anywhere.
 */
describe("attribution token — transport", () => {
  it("only ever uses characters a Stripe Payment Link accepts", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateAttributionToken().plaintext).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it("fits client_reference_id (200) and a metadata value (500)", () => {
    const { plaintext } = generateAttributionToken()
    expect(plaintext.length).toBeLessThanOrEqual(200)
    expect(ATTRIBUTION_METADATA_KEY.length).toBeLessThanOrEqual(40)
  })

  it("is distinct every time", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateAttributionToken().plaintext))
    expect(seen.size).toBe(500)
  })

  it("stores only the hash, and the hash is not the token", () => {
    const { plaintext, hash, prefix } = generateAttributionToken()
    expect(hash).not.toContain(plaintext)
    expect(plaintext.startsWith(prefix)).toBe(true)
    expect(prefix.length).toBe(ATTRIBUTION_TOKEN_PREFIX.length + 6)
  })
})

describe("attribution token — recognition", () => {
  const token = generateAttributionToken().plaintext

  it("accepts its own tokens", () => {
    expect(isAttributionToken(token)).toBe(true)
    expect(attributionTokenPrefix(token)).toBe(token.slice(0, 10))
  })

  it("rejects everything that is not one", () => {
    for (const value of ["", "cart_1234", "ifx_", "ifx_short", token.slice(4), null, undefined, 42, {}]) {
      expect(isAttributionToken(value)).toBe(false)
    }
  })

  it("reads a founder's own client_reference_id as 'no token', not as an error", () => {
    expect(readAttributionToken("cart_9182")).toBeNull()
    expect(readAttributionToken(token)).toBe(token)
    expect(readAttributionToken(`  ${token}  `)).toBe(token)
  })

  it("reads the token out of provider metadata under one key only", () => {
    expect(readAttributionTokenFromMetadata({ [ATTRIBUTION_METADATA_KEY]: token })).toBe(token)
    expect(readAttributionTokenFromMetadata({ other: token })).toBeNull()
    expect(readAttributionTokenFromMetadata(null)).toBeNull()
    expect(readAttributionTokenFromMetadata(undefined)).toBeNull()
  })
})
