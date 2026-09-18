import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { identifyBodySchema } from "@/lib/api/contract"
import { STRIPE_HANDLED_EVENTS } from "@/lib/billing/stripe/events"
import { applyBasisPoints } from "@/lib/money"
import { trackerSource } from "@/lib/tracking/script"
import { VISITOR_COOKIE } from "@/lib/tracking/constants"
import { isValidVisitorId } from "@/lib/tracking/visitor"

import {
  COMMISSION_EXAMPLE,
  IDENTIFY_EXAMPLE,
  STRIPE_TRIGGER_COMMAND,
  customerFirstSnippet,
  identifyCurl,
  identifyEndpoint,
  identifyTypeScript,
  stripeEventsText,
  trackerSnippet,
  visitorIdFromCookie,
  visitorIdFromForm,
  webhookUrl,
} from "../snippets"

/**
 * The integration guide is the first thing a founder copies. These checks
 * keep every sample honest against the code that serves it, so a renamed
 * attribute, a new required field or a dropped Stripe event fails CI instead
 * of silently breaking someone's integration.
 */
const APP = "https://app.refvia.test"

describe("tracker snippet", () => {
  it("loads the served tracker path with the attribute the script reads", () => {
    const snippet = trackerSnippet(APP)
    expect(snippet).toContain(`src="${APP}/t.js"`)
    const attribute = snippet.match(/(data-[a-z-]+)="pk_test_/)?.[1]
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
    expect(curl).toMatch(/Authorization: Bearer sk_test_/)
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

describe("visitor id samples", () => {
  it("read the cookie the tracker writes, and the value it exposes", () => {
    const source = trackerSource(`${APP}/api/track`)
    expect(visitorIdFromCookie()).toContain(`${VISITOR_COOKIE}=`)
    expect(source).toContain(`var COOKIE = "${VISITOR_COOKIE}"`)
    expect(visitorIdFromForm()).toContain("window.Referral.visitorId")
    expect(source).toContain("window.Referral = {")
  })

  it("the cookie regex extracts a valid visitor id from a Cookie header", () => {
    const pattern = visitorIdFromCookie().match(/match\((\/.+\/)\)/)?.[1]
    expect(pattern).toBeDefined()
    const regex = new RegExp(pattern!.slice(1, -1))
    const header = `theme=dark; ${VISITOR_COOKIE}=v_k3n9q2x7m4p8r1t6w5z0; other=1`
    const value = header.match(regex)?.[1]
    expect(isValidVisitorId(value)).toBe(true)
  })
})

describe("identify reference", () => {
  it("names the identify route", () => {
    expect(identifyEndpoint(APP)).toBe(`POST ${APP}/api/identify`)
    expect(existsSync(join(process.cwd(), "src/app/api/identify/route.ts"))).toBe(true)
  })
})

describe("webhook", () => {
  it("the copyable event list is exactly the handled events", () => {
    const types = STRIPE_HANDLED_EVENTS.map((event) => event.type)
    expect(stripeEventsText(types).split("\n")).toEqual(types)
  })

  it("the CLI test event is one the adapter handles", () => {
    const type = STRIPE_TRIGGER_COMMAND.replace("stripe trigger ", "")
    expect(STRIPE_HANDLED_EVENTS.map((event) => event.type)).toContain(type)
  })

  it("points at the per-integration Stripe webhook route", () => {
    expect(webhookUrl(APP, "INTEGRATION_ID")).toBe(`${APP}/api/webhooks/stripe/INTEGRATION_ID`)
    expect(
      existsSync(join(process.cwd(), "src/app/api/webhooks/stripe/[integrationId]/route.ts")),
    ).toBe(true)
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

describe("customer-first sample", () => {
  it("calls the real identify route with fields the schema knows and the tracker's cookie", () => {
    const sample = customerFirstSnippet(APP)
    expect(sample).toContain(`${APP}/api/identify`)
    expect(sample).toContain(VISITOR_COOKIE)
    const body = sample.slice(sample.indexOf("JSON.stringify({"), sample.indexOf("}),"))
    const sent = [...body.matchAll(/^\s{6}(\w+)[,:]/gm)].map((match) => match[1])
    expect(sent).toEqual(["visitorId", "externalId", "email"])
    for (const field of sent) expect(Object.keys(identifyBodySchema.shape)).toContain(field)
    // The same regex a founder copies must read a real cookie header.
    const regex = new RegExp(sample.match(/\.match\(\/(.+)\/\)/)![1]!)
    expect("a=1; " + VISITOR_COOKIE + "=v_abc; b=2").toMatch(regex)
  })
})
