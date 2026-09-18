/**
 * The Universal Checkout Bridge (UNIVERSAL_ATTRIBUTION_ARCHITECTURE.md §4).
 *
 * The founder learns one call — `checkoutFields(provider, { token, customerId })`
 * — and spreads the result into whatever payload creates their checkout. Which
 * provider field carries what is decided here, once, and nowhere else:
 *
 *   stripe        client_reference_id + metadata          (Checkout Session)
 *   mercado_pago  external_reference  + metadata          (preference / payment)
 *   abacatepay    externalId                              (checkout)
 *   asaas         externalReference                       (payment / subscription)
 *
 * Pure: the in-product guide renders this very function as the snippet the
 * founder copies, and a unit test pins every mapping against the adapters that
 * read it back. Never a secret in here — a token is a public correlation handle.
 */

import type { ConnectorId } from "./catalog"
import {
  ATTRIBUTION_METADATA_KEY,
  CUSTOMER_METADATA_KEY,
  isAttributionToken,
} from "@/lib/tracking/attribution-token"

export interface CheckoutAttribution {
  /** The `_referral_ref` cookie / `window.Referral.attributionToken`. Omit when there is none. */
  token?: string | null
  /** Your own, stable user id — the same one sent to `/api/identify`. */
  customerId?: string | null
}

export interface CheckoutFieldsResult {
  /** Spread into the provider's create-checkout payload. Empty when there is nothing to carry. */
  fields: Record<string, unknown>
  /**
   * Where the customer id went: `metadata`, or `identify` when this provider
   * cannot carry it back on its webhooks and `/api/identify` is the way.
   */
  customer: "metadata" | "identify" | "none"
}

export function checkoutFields(provider: ConnectorId, attribution: CheckoutAttribution): CheckoutFieldsResult {
  const token = attribution.token && isAttributionToken(attribution.token) ? attribution.token : null
  const customerId = attribution.customerId?.trim() || null

  switch (provider) {
    case "stripe": {
      const metadata: Record<string, string> = {}
      if (token) metadata[ATTRIBUTION_METADATA_KEY] = token
      if (customerId) metadata[CUSTOMER_METADATA_KEY] = customerId
      return {
        fields: {
          ...(token ? { client_reference_id: token } : {}),
          ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        },
        customer: customerId ? "metadata" : "none",
      }
    }
    case "mercado_pago": {
      const metadata: Record<string, string> = {}
      if (token) metadata[ATTRIBUTION_METADATA_KEY] = token
      if (customerId) metadata[CUSTOMER_METADATA_KEY] = customerId
      return {
        fields: {
          // ≤ 64 chars of [A-Za-z0-9_-] — an `ifx_` token is 47 of exactly those.
          ...(token ? { external_reference: token } : {}),
          ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        },
        customer: customerId ? "metadata" : "none",
      }
    }
    case "abacatepay":
      return {
        // Only `externalId` is echoed in AbacatePay webhooks; metadata is not.
        fields: token ? { externalId: token } : {},
        customer: customerId ? "identify" : "none",
      }
    case "asaas":
      return {
        // Asaas has no metadata; `externalReference` is the only free field.
        fields: token ? { externalReference: token } : {},
        customer: customerId ? "identify" : "none",
      }
  }
}
