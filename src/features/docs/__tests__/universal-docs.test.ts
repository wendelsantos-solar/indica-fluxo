import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { CONNECTORS } from "@/lib/billing/catalog"
import { INDEXABLE_PAGES } from "@/lib/seo/pages"

import { BETA_CONNECTORS, bridgeFieldNames } from "../universal"

describe("universal integration facts in the guide", () => {
  it("names exactly the fields checkoutFields writes for each provider", () => {
    expect(bridgeFieldNames("stripe")).toEqual({
      token: "client_reference_id · metadata.indicafluxo_ref",
      customer: "metadata.indicafluxo_customer",
    })
    expect(bridgeFieldNames("mercado_pago")).toEqual({
      token: "external_reference · metadata.indicafluxo_ref",
      customer: "metadata.indicafluxo_customer",
    })
    // No metadata echoed back: the customer id must come through identify.
    expect(bridgeFieldNames("abacatepay")).toEqual({ token: "externalId", customer: null })
    expect(bridgeFieldNames("asaas")).toEqual({ token: "externalReference", customer: null })
  })

  it("documents as beta exactly the connectors the catalog ships as beta", () => {
    expect(BETA_CONNECTORS.every((id) => CONNECTORS[id].defaultAvailability === "beta")).toBe(true)
    expect(BETA_CONNECTORS).toEqual(["mercado_pago", "abacatepay", "asaas"])
  })

  it("never makes the beta page indexable before a connector is production-ready", () => {
    expect(INDEXABLE_PAGES.map((page) => page.href)).not.toContain("/docs/beta")
  })

  it("keeps the beta guide reachable signed out — the public guide links to it", () => {
    const proxy = readFileSync(join(process.cwd(), "src/proxy.ts"), "utf8")
    const publicPaths = proxy.slice(proxy.indexOf("const PUBLIC_PATHS"), proxy.indexOf("])", proxy.indexOf("const PUBLIC_PATHS")))
    expect(publicPaths).toContain(`"/docs/beta"`)
  })
})
