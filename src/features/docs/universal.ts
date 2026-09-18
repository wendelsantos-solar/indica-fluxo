/**
 * Facts the guide shows about the universal integration, derived from the code
 * that implements them — so the page cannot drift from `checkoutFields` or the
 * catalog (`__tests__/universal-docs.test.ts` pins both).
 */

import { CONNECTORS, CONNECTOR_IDS, type ConnectorId } from "@/lib/billing/catalog"
import { checkoutFields } from "@/lib/billing/checkout-bridge"

/** Connectors documented on the beta page (`/docs/beta`), never on SEO pages. */
export const BETA_CONNECTORS = CONNECTOR_IDS.filter((id) => CONNECTORS[id].defaultAvailability === "beta") as Exclude<
  ConnectorId,
  "stripe"
>[]

const SAMPLE_TOKEN = `ifx_${"A".repeat(43)}`

/** Where `checkoutFields` puts the reference and the customer id, as dotted field names. */
export function bridgeFieldNames(provider: ConnectorId): { token: string; customer: string | null } {
  const { fields, customer } = checkoutFields(provider, { token: SAMPLE_TOKEN, customerId: "user_1" })
  const paths: string[] = []
  const walk = (value: unknown, prefix: string) => {
    if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) walk(inner, prefix ? `${prefix}.${key}` : key)
    } else paths.push(`${prefix}=${String(value)}`)
  }
  walk(fields, "")
  const tokenPaths = paths.filter((path) => path.endsWith(`=${SAMPLE_TOKEN}`)).map((path) => path.split("=")[0]!)
  const customerPath = paths.find((path) => path.endsWith("=user_1"))?.split("=")[0] ?? null
  return { token: tokenPaths.join(" · "), customer: customer === "metadata" ? customerPath : null }
}
