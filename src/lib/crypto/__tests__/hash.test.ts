import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/env/server", () => ({ env: () => ({ HASH_PEPPER: "test-pepper" }) }))

const { API_KEY_PATTERN, apiKeyEnvironment, generateApiKey, peppered } = await import("../hash")

describe("generateApiKey", () => {
  it.each([
    ["publishable", "test", "pk_test_"],
    ["secret", "test", "sk_test_"],
    ["publishable", "live", "pk_live_"],
    ["secret", "live", "sk_live_"],
  ] as const)("issues a %s %s key as %s…", (type, environment, prefix) => {
    const key = generateApiKey(type, environment)
    expect(key.plaintext.startsWith(prefix)).toBe(true)
    expect(key.prefix.startsWith(prefix)).toBe(true)
    expect(key.plaintext).toMatch(API_KEY_PATTERN)
    expect(apiKeyEnvironment(key.plaintext)).toBe(environment)
    // Only the peppered hash is stored.
    expect(key.hash).toBe(peppered(key.plaintext))
    expect(key.hash).not.toContain(key.plaintext)
  })

  it("never issues the same key twice", () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey("secret", "test").plaintext))
    expect(keys.size).toBe(50)
  })

  it("reads no environment from a malformed key", () => {
    expect(apiKeyEnvironment("pk_prod_abcdefghijklmnop")).toBeNull()
    expect(apiKeyEnvironment("sk_live_short")).toBeNull()
  })
})
