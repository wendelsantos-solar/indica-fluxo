import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { identifyBodySchema } from "@/lib/api/contract"
import { STRIPE_HANDLED_EVENTS } from "@/lib/billing/stripe/events"
import { applyBasisPoints } from "@/lib/money"
import { trackerSource } from "@/lib/tracking/script"
import { isValidVisitorId } from "@/lib/tracking/visitor"

import {
  COMMISSION_EXAMPLE,
  IDENTIFY_EXAMPLE,
  identifyCurl,
  identifyTypeScript,
  trackerSnippet,
  webhookUrl,
} from "../snippets"

/**
 * The integration guide is the first thing a founder copies. These checks
 * keep every sample honest against the code that serves it, so a renamed
 * attribute, a new required field or a dropped Stripe event fails CI instead
 * of silently breaking someone's integration.
 */
const APP = "https://app.indicafluxo.test"

describe("tracker snippet", () => {
  it("loads the served tracker path with the attribute the script reads", () => {
    const snippet = trackerSnippet(APP)
    expect(snippet).toContain(`src="${APP}/t.js"`)
    const attribute = snippet.match(/(data-[a-z-]+)="pk_live_/)?.[1]
    expect(attribute).toBe("data-key")
    expect(trackerSource(`${APP}/api/track`)).toContain(`getAttribute("${attribute}")`)
  })
})

describe("identify examples", () => {
  it("send a body the server accepts", () => {
    expect(identifyBodySchema.safeParse(IDENTIFY_EXAMPLE).success).toBe(true)
    expect(isValidVisitorId(IDENTIFY_EXAMPLE.visitorId)).toBe(true)
  })

  it("cURL carries the same JSON and a Bearer secret key", () => {
    const curl = identifyCurl(APP)
    expect(curl).toContain(`${APP}/api/identify`)
    expect(curl).toMatch(/Authorization: Bearer sk_live_/)
    const json = curl.slice(curl.indexOf("-d '") + 4, curl.lastIndexOf("'"))
    expect(identifyBodySchema.parse(JSON.parse(json))).toEqual(IDENTIFY_EXAMPLE)
  })

  it("TypeScript names only fields the schema knows", () => {
    const ts = identifyTypeScript(APP)
    const body = ts.slice(ts.indexOf("JSON.stringify({"), ts.indexOf("}),"))
    const known = Object.keys(identifyBodySchema.shape)
    const sent = [...body.matchAll(/^\s{4}(\w+)[,:]/gm)].map((match) => match[1])
    expect(sent.length).toBeGreaterThan(0)
    for (const field of sent) expect(known).toContain(field)
  })
})

describe("webhook", () => {
  it("points at the Stripe webhook route", () => {
    expect(webhookUrl(APP)).toBe(`${APP}/api/webhooks/stripe`)
  })

  it("lists exactly the event types the adapter handles", () => {
    const adapter = readFileSync(join(process.cwd(), "src/lib/billing/stripe/adapter.ts"), "utf8")
    const handled = [...adapter.matchAll(/case "([a-z_.]+)":/g)].map((match) => match[1]).sort()
    expect(STRIPE_HANDLED_EVENTS.map((event) => event.type).sort()).toEqual(handled)
  })
})

describe("commission example", () => {
  it("uses the engine's own arithmetic", () => {
    expect(COMMISSION_EXAMPLE.commissionMinor).toBe(applyBasisPoints(4900, 3000))
    expect(COMMISSION_EXAMPLE.commissionMinor).toBe(1470)
  })
})
