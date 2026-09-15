import { runInNewContext } from "node:vm"

import { describe, expect, it, vi } from "vitest"

import { trackerSource } from "../script"

/** Runs the tracker in a minimal browser-like context and returns where it posted. */
function run({ src, search }: { src: string; search: string }) {
  const fetch = vi.fn<(url: string, init?: unknown) => Promise<unknown>>(() => Promise.resolve({}))
  const script = { src, getAttribute: (name: string) => (name === "data-key" ? "pk_test_abcdefghijklmnop" : null) }
  const context = {
    document: { currentScript: script, cookie: "", querySelector: () => script, referrer: "" },
    location: { search, href: `https://customer.example${search}`, protocol: "https:" },
    navigator: {},
    URL,
    URLSearchParams,
    Uint8Array,
    Math,
    JSON,
    RegExp,
    encodeURIComponent,
    decodeURIComponent,
    fetch,
    crypto: globalThis.crypto,
    window: {} as Record<string, unknown>,
  }
  context.window = { fetch, crypto: globalThis.crypto }
  runInNewContext(trackerSource("http://localhost:3000/api/track"), context)
  return fetch
}

describe("tracker script", () => {
  it("posts to the host that served it, not the endpoint baked in at build time", () => {
    const fetch = run({ src: "https://app.indicafluxo.com.br/t.js", search: "?ref=wendel" })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]![0]).toBe("https://app.indicafluxo.com.br/api/track")
  })

  it("sends nothing without a referral code in the URL", () => {
    expect(run({ src: "https://app.indicafluxo.com.br/t.js", search: "?utm_source=x" })).not.toHaveBeenCalled()
  })
})
