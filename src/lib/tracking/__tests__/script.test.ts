import { runInNewContext } from "node:vm"

import { describe, expect, it, vi } from "vitest"

import { trackerSource } from "../script"

/** Runs the tracker in a minimal browser-like context and returns where it posted. */
function run({
  src,
  search,
  hostname = "customer.example",
  cookieDomain,
}: {
  src: string
  search: string
  hostname?: string
  cookieDomain?: string
}) {
  const fetch = vi.fn<(url: string, init?: unknown) => Promise<unknown>>(() => Promise.resolve({}))
  const attributes: Record<string, string | undefined> = {
    "data-key": "pk_test_abcdefghijklmnop",
    "data-cookie-domain": cookieDomain,
  }
  const script = { src, getAttribute: (name: string) => attributes[name] ?? null }
  const context = {
    document: { currentScript: script, cookie: "", querySelector: () => script, referrer: "" },
    location: { search, hostname, href: `https://${hostname}${search}`, protocol: "https:" },
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
  return Object.assign(fetch, { cookie: () => context.document.cookie, referral: () => context.window.Referral })
}

describe("tracker script", () => {
  it("posts to the host that served it, not the endpoint baked in at build time", () => {
    const fetch = run({ src: "https://app.refvia.com.br/t.js", search: "?ref=wendel" })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]![0]).toBe("https://app.refvia.com.br/api/track")
  })

  it("scopes the visitor cookie to the configured parent domain", () => {
    const tracker = run({
      src: "https://app.refvia.com.br/t.js",
      search: "?ref=wendel",
      hostname: "www.customer.example",
      cookieDomain: "customer.example",
    })
    expect(tracker.cookie()).toContain("; Domain=customer.example")
  })

  it("ignores a cookie domain the page is not under, keeping the cookie on its own host", () => {
    const tracker = run({
      src: "https://app.refvia.com.br/t.js",
      search: "?ref=wendel",
      hostname: "www.customer.example",
      cookieDomain: "other.example",
    })
    expect(tracker.cookie()).not.toContain("Domain=")
  })

  it("exposes the visitor id on a page without a referral code, for the signup form", () => {
    const tracker = run({ src: "https://app.refvia.com.br/t.js", search: "" })
    expect(tracker.referral()).toMatchObject({ visitorId: expect.stringMatching(/^v_/), ref: null })
  })

  it("sends nothing without a referral code in the URL", () => {
    expect(run({ src: "https://app.refvia.com.br/t.js", search: "?utm_source=x" })).not.toHaveBeenCalled()
  })
})

/**
 * The attribution reference (INTEGRATION_ARCHITECTURE_V2.md §2). A richer
 * context than the runner above: these tests need a DOM with links and a fetch
 * that answers, because the zero-code Payment Links path lives entirely in the
 * tracker.
 */
function runWithDom({
  search,
  cookie = "",
  token = null,
  hrefs = [],
  decorate,
}: {
  search: string
  cookie?: string
  /** What `/api/track` answers with. */
  token?: string | null
  hrefs?: string[]
  decorate?: string
}) {
  const anchors = hrefs.map((href) => {
    const attrs: Record<string, string> = { href }
    return {
      getAttribute: (name: string) => attrs[name] ?? null,
      setAttribute: (name: string, value: string) => {
        attrs[name] = value
      },
      href: () => attrs.href,
    }
  })

  const fetch = vi.fn<(url: string, init: { body: string }) => Promise<unknown>>(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, token }) }),
  )
  const attributes: Record<string, string | undefined> = {
    "data-key": "pk_test_abcdefghijklmnop",
    "data-decorate-links": decorate,
  }
  const script = { src: "https://app.example.com/t.js", getAttribute: (n: string) => attributes[n] ?? null }
  // A real browser merges each assignment into the jar; a plain string field
  // would let the visitor cookie wipe the reference cookie written before it.
  const jar = new Map<string, string>()
  for (const pair of cookie.split("; ").filter(Boolean)) {
    const [name, ...rest] = pair.split("=")
    jar.set(name!, rest.join("="))
  }
  const document = {
    currentScript: script,
    querySelector: () => script,
    querySelectorAll: () => anchors,
    referrer: "",
    readyState: "complete",
    addEventListener: () => {},
    get cookie() {
      return [...jar].map(([name, value]) => `${name}=${value}`).join("; ")
    },
    set cookie(value: string) {
      const [name, ...rest] = value.split(";")[0]!.split("=")
      jar.set(name!, rest.join("="))
    },
  }

  const context = {
    document,
    location: { search, hostname: "customer.example", href: `https://customer.example/${search}`, protocol: "https:" },
    navigator: {},
    URL,
    URLSearchParams,
    Uint8Array,
    Math,
    JSON,
    RegExp,
    Promise,
    encodeURIComponent,
    decodeURIComponent,
    fetch,
    crypto: globalThis.crypto,
    window: {} as Record<string, unknown>,
  }
  context.window = { fetch, crypto: globalThis.crypto }
  runInNewContext(trackerSource("http://localhost:3000/api/track"), context)

  return {
    fetch,
    anchors,
    cookie: () => document.cookie,
    referral: () => context.window.Referral as { attributionToken: string | null },
  }
}

const TOKEN = `ifx_${"a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0u1V"}`

describe("tracker script — attribution reference", () => {
  it("sends the reference it already holds, so one visitor keeps one reference", async () => {
    const run = runWithDom({ search: "?ref=wendel", cookie: `_referral_ref=${TOKEN}` })
    const body = JSON.parse(run.fetch.mock.calls[0]![1].body)
    expect(body.token).toBe(TOKEN)
  })

  it("stores the reference the API returns, on the founder's own domain", async () => {
    const run = runWithDom({ search: "?ref=wendel", token: TOKEN })
    // Two chained `.then`s after fetch: let the microtask queue drain.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(run.cookie()).toContain(`_referral_ref=${TOKEN}`)
    expect(run.referral().attributionToken).toBe(TOKEN)
  })

  it("appends client_reference_id to Stripe Payment Links — the no-code integration", () => {
    const run = runWithDom({
      search: "",
      cookie: `_referral_ref=${TOKEN}`,
      hrefs: ["https://buy.stripe.com/test_abc", "https://example.com/pricing"],
    })
    expect(run.anchors[0]!.href()).toBe(`https://buy.stripe.com/test_abc?client_reference_id=${TOKEN}`)
    // Anything that is not a Stripe checkout is left alone.
    expect(run.anchors[1]!.href()).toBe("https://example.com/pricing")
  })

  it("never overwrites a client_reference_id the founder set themselves", () => {
    const run = runWithDom({
      search: "",
      cookie: `_referral_ref=${TOKEN}`,
      hrefs: ["https://buy.stripe.com/test_abc?client_reference_id=theirs"],
    })
    expect(run.anchors[0]!.href()).toBe("https://buy.stripe.com/test_abc?client_reference_id=theirs")
  })

  it("decorates nothing with data-decorate-links=off, or without a reference", () => {
    const off = runWithDom({
      search: "",
      cookie: `_referral_ref=${TOKEN}`,
      hrefs: ["https://buy.stripe.com/x"],
      decorate: "off",
    })
    expect(off.anchors[0]!.href()).toBe("https://buy.stripe.com/x")

    const none = runWithDom({ search: "", hrefs: ["https://buy.stripe.com/x"] })
    expect(none.anchors[0]!.href()).toBe("https://buy.stripe.com/x")
  })

  it("ignores a malformed reference in the cookie", () => {
    const run = runWithDom({ search: "?ref=wendel", cookie: "_referral_ref=not-a-token" })
    const body = JSON.parse(run.fetch.mock.calls[0]![1].body)
    expect(body.token).toBeNull()
  })
})
