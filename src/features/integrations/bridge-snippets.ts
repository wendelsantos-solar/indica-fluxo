/**
 * The checkout-bridge samples shown on Integrations, generated FROM
 * `checkoutFields` itself — so what the founder copies is exactly what the
 * adapters read back (a test pins it). Pure.
 */

import { CONNECTORS, type ConnectorId } from "@/lib/billing/catalog"
import { checkoutFields } from "@/lib/billing/checkout-bridge"

const TOKEN_PLACEHOLDER = `ifx_${"T".repeat(43)}`
const CUSTOMER_PLACEHOLDER = "__CUSTOMER__"

/** The documented create-checkout call of each provider, named for orientation only. */
const ENDPOINT: Record<ConnectorId, string> = {
  stripe: "POST /v1/checkout/sessions",
  mercado_pago: "POST /checkout/preferences",
  abacatepay: "POST /v2/checkouts/create",
  asaas: "POST /v3/payments · POST /v3/subscriptions",
}

function literal(value: unknown, indent: number): string {
  const pad = "  ".repeat(indent)
  if (typeof value === "string") {
    if (value === TOKEN_PLACEHOLDER) return "token"
    if (value === CUSTOMER_PLACEHOLDER) return "user.id"
    return JSON.stringify(value)
  }
  const entries = Object.entries(value as Record<string, unknown>)
  return `{\n${entries.map(([key, inner]) => `${pad}  ${key}: ${literal(inner, indent + 1)},`).join("\n")}\n${pad}}`
}

export function checkoutBridgeSnippet(provider: ConnectorId): string {
  const { fields, customer } = checkoutFields(provider, { token: TOKEN_PLACEHOLDER, customerId: CUSTOMER_PLACEHOLDER })
  const body = Object.entries(fields)
    .map(([key, value]) => `  ${key}: ${literal(value, 1)},`)
    .join("\n")
  const lines = [
    `// ${CONNECTORS[provider].name} — ${ENDPOINT[provider]}`,
    `// token: the _referral_ref cookie of this request (window.Referral.attributionToken in the browser)`,
    `const payload = {`,
    `  ...yourCheckoutPayload,`,
    body,
    `}`,
  ]
  if (customer === "identify") {
    lines.push(`// ${CONNECTORS[provider].name} does not return metadata on its webhooks:`, `// POST /api/identify links user.id to the customer instead.`)
  }
  return lines.join("\n")
}
