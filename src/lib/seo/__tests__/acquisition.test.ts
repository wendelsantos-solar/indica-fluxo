import { describe, expect, it } from "vitest"

import {
  captureAcquisition,
  classifyChannel,
  decodeAcquisition,
  encodeAcquisition,
} from "../acquisition"

const locales = ["pt-br", "en"] as const
const at = new Date("2026-09-18T12:00:00Z")

function capture(url: string, referrer: string | null = null) {
  return captureAcquisition({ url: new URL(url), referrer, locales, ownHosts: ["www.site.com"], now: at })
}

describe("first-touch acquisition", () => {
  it("recognises an organic search visit on an SEO landing page", () => {
    const touch = capture("https://www.site.com/pt-br/programa-de-afiliados-saas", "https://www.google.com.br/")
    expect(touch).toEqual({
      v: 1,
      channel: "organic_search",
      landing: "/pt-br/programa-de-afiliados-saas",
      locale: "pt-br",
      referrer: "www.google.com.br",
      utm: {},
      at: at.toISOString(),
    })
  })

  it("keeps UTM values and lets the medium decide the channel", () => {
    const touch = capture("https://www.site.com/en?utm_source=newsletter&utm_medium=email&utm_campaign=launch")
    expect(touch.channel).toBe("email")
    expect(touch.utm).toEqual({ source: "newsletter", medium: "email", campaign: "launch" })
    expect(touch.landing).toBe("/en")
  })

  it("never stores the full referrer URL or the query string of the landing page", () => {
    const touch = capture("https://www.site.com/en/pricing?email=a@b.com", "https://www.bing.com/search?q=affiliate+software")
    expect(touch.referrer).toBe("www.bing.com")
    expect(touch.landing).toBe("/en/pricing")
    expect(JSON.stringify(touch)).not.toContain("a@b.com")
    expect(JSON.stringify(touch)).not.toContain("affiliate+software")
  })

  it("classifies by referrer when there is no campaign", () => {
    const channel = (referrerHost: string | null) =>
      classifyChannel({ referrerHost, ownHosts: ["www.site.com"], hasUtm: false, hasAdClickId: false })
    expect(channel("duckduckgo.com")).toBe("organic_search")
    expect(channel("www.linkedin.com")).toBe("social")
    expect(channel("news.ycombinator.com")).toBe("social")
    expect(channel("blog.someone.dev")).toBe("referral")
    expect(channel("www.site.com")).toBe("direct")
    expect(channel(null)).toBe("direct")
  })

  it("treats ad click ids and paid mediums as paid, whatever the referrer", () => {
    expect(capture("https://www.site.com/pt-br?gclid=abc", "https://www.google.com/").channel).toBe("paid")
    expect(capture("https://www.site.com/pt-br?utm_medium=cpc&utm_source=google").channel).toBe("paid")
  })

  it("round-trips through the cookie and rejects anything tampered", () => {
    const touch = capture("https://www.site.com/en/stripe-affiliate-software", "https://www.google.com/")
    expect(decodeAcquisition(encodeAcquisition(touch))).toEqual(touch)
    expect(decodeAcquisition("not-json")).toBeNull()
    expect(decodeAcquisition(encodeURIComponent(JSON.stringify({ ...touch, channel: "bribe" })))).toBeNull()
    expect(decodeAcquisition(undefined)).toBeNull()
  })
})
