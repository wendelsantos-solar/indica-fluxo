import { describe, expect, it } from "vitest"

import { CONNECTORS, CONNECTOR_IDS, isConnectable, resolveAvailability } from "@/lib/billing/catalog"
import { checkoutFields } from "@/lib/billing/checkout-bridge"
import { attributionCustomerKey, guestCustomerId } from "@/lib/billing/identity-key"
import { EXPECTED_REASONS, REASON_CODES, reasonForSkip } from "@/lib/billing/reasons"
import { decimalToMinor } from "@/lib/money"
import { ATTRIBUTION_METADATA_KEY, CUSTOMER_METADATA_KEY } from "@/lib/tracking/attribution-token"

const TOKEN = `ifx_${"a".repeat(43)}`

describe("decimalToMinor", () => {
  it("shifts digits instead of multiplying floats", () => {
    expect(decimalToMinor(94.51, "BRL")).toBe(9451)
    expect(decimalToMinor("94.51", "BRL")).toBe(9451)
    expect(decimalToMinor(19.99, "BRL")).toBe(1999)
    expect(decimalToMinor("1500", "JPY")).toBe(1500)
    expect(decimalToMinor("24.50", "BRL")).toBe(2450)
    expect(decimalToMinor("10.100", "BRL")).toBe(1010)
  })

  it("refuses what is not a plain decimal of the currency", () => {
    expect(decimalToMinor("94.505", "BRL")).toBeNull()
    expect(decimalToMinor("-1", "BRL")).toBeNull()
    expect(decimalToMinor("1e3", "BRL")).toBeNull()
    expect(decimalToMinor(Number.NaN, "BRL")).toBeNull()
    expect(decimalToMinor(null, "BRL")).toBeNull()
    expect(decimalToMinor("12.5", "JPY")).toBeNull()
  })
})

describe("checkoutFields — the universal checkout bridge", () => {
  it("maps one call onto each provider's own fields", () => {
    expect(checkoutFields("stripe", { token: TOKEN, customerId: "user_42" })).toEqual({
      fields: {
        client_reference_id: TOKEN,
        metadata: { [ATTRIBUTION_METADATA_KEY]: TOKEN, [CUSTOMER_METADATA_KEY]: "user_42" },
      },
      customer: "metadata",
    })
    expect(checkoutFields("mercado_pago", { token: TOKEN, customerId: "user_42" }).fields).toEqual({
      external_reference: TOKEN,
      metadata: { [ATTRIBUTION_METADATA_KEY]: TOKEN, [CUSTOMER_METADATA_KEY]: "user_42" },
    })
    expect(checkoutFields("abacatepay", { token: TOKEN, customerId: "user_42" })).toEqual({
      fields: { externalId: TOKEN },
      customer: "identify",
    })
    expect(checkoutFields("asaas", { token: TOKEN, customerId: "user_42" })).toEqual({
      fields: { externalReference: TOKEN },
      customer: "identify",
    })
  })

  it("carries nothing when there is nothing to carry, and never a malformed token", () => {
    for (const provider of CONNECTOR_IDS) {
      expect(checkoutFields(provider, {}).fields).toEqual({})
      expect(checkoutFields(provider, { token: "not-a-token" }).fields).toEqual({})
    }
  })

  it("keeps Mercado Pago's external_reference inside its 64-character alphabet", () => {
    const { fields } = checkoutFields("mercado_pago", { token: TOKEN })
    expect(String(fields.external_reference)).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
  })
})

describe("catalog", () => {
  it("describes every connector, with Stripe public and the others beta", () => {
    expect(CONNECTORS.stripe.defaultAvailability).toBe("public")
    for (const id of ["mercado_pago", "abacatepay", "asaas"] as const) {
      expect(CONNECTORS[id].defaultAvailability).toBe("beta")
    }
  })

  it("turns a disabled beta connector into coming soon, never Stripe", () => {
    const availability = resolveAvailability(["asaas", "stripe"])
    expect(availability.asaas).toBe("coming_soon")
    expect(availability.stripe).toBe("public")
    expect(isConnectable(availability.asaas)).toBe(false)
    expect(isConnectable(availability.mercado_pago)).toBe(true)
  })

  it("states the gaps the providers document", () => {
    expect(CONNECTORS.abacatepay.capabilities.partialRefunds).toBe(false)
    expect(CONNECTORS.abacatepay.capabilities.disputeWon).toBe(false)
    expect(CONNECTORS.mercado_pago.capabilities.automaticWebhook).toBe(false)
    expect(CONNECTORS.asaas.capabilities.automaticWebhook).toBe(true)
  })
})

describe("identity keys", () => {
  it("keeps Stripe ids bare and namespaces every other provider (no cross-provider collision)", () => {
    expect(attributionCustomerKey("stripe", "123")).toBe("123")
    expect(attributionCustomerKey("mercado_pago", "123")).toBe("mercado_pago:123")
    expect(attributionCustomerKey("mercado_pago", "123")).not.toBe(attributionCustomerKey("stripe", "123"))
    expect(attributionCustomerKey("asaas", "cus_1")).not.toBe(attributionCustomerKey("abacatepay", "cus_1"))
    expect(guestCustomerId("pay_1")).toBe("guest:pay_1")
  })
})

describe("reason codes", () => {
  it("maps every engine skip reason onto the closed list", () => {
    for (const skip of [
      "participation_not_approved",
      "attribution_expired",
      "recurrence_window_closed",
      "currency_mismatch",
      "non_commissionable_transaction",
      "zero_amount",
      "no_original_commission",
    ] as const) {
      expect(REASON_CODES).toContain(reasonForSkip(skip))
    }
  })

  it("treats an organic customer as expected, a dropped payment as a fault", () => {
    expect(EXPECTED_REASONS.has("NO_ATTRIBUTION")).toBe(true)
    expect(EXPECTED_REASONS.has("CUSTOMER_NOT_LINKED")).toBe(false)
    expect(EXPECTED_REASONS.has("TEST_LIVE_MISMATCH")).toBe(false)
  })
})

describe("checkout bridge snippets", async () => {
  const { checkoutBridgeSnippet } = await import("@/features/integrations/bridge-snippets")
  it("shows exactly the fields checkoutFields produces, with the token and user id as variables", () => {
    expect(checkoutBridgeSnippet("stripe")).toContain("client_reference_id: token,")
    expect(checkoutBridgeSnippet("stripe")).toContain(`${CUSTOMER_METADATA_KEY}: user.id,`)
    expect(checkoutBridgeSnippet("mercado_pago")).toContain("external_reference: token,")
    expect(checkoutBridgeSnippet("abacatepay")).toContain("externalId: token,")
    expect(checkoutBridgeSnippet("asaas")).toContain("externalReference: token,")
    expect(checkoutBridgeSnippet("asaas")).toContain("/api/identify")
    for (const provider of CONNECTOR_IDS) expect(checkoutBridgeSnippet(provider)).not.toContain("TTTT")
  })
})
