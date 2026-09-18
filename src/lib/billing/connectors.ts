import "server-only"

import { AbacatePayConnector } from "./abacatepay/connector"
import { AsaasConnector } from "./asaas/connector"
import type { ConnectorId } from "./catalog"
import type { BillingConnector } from "./connector"
import { MercadoPagoConnector } from "./mercado-pago/connector"

/**
 * The non-Stripe connectors. Adding a provider is one folder, one entry here and
 * one entry in `catalog.ts` — the ingest route, the ledger and the commission
 * engine do not change (UNIVERSAL_ATTRIBUTION_ARCHITECTURE.md §5).
 */
const registry: Record<Exclude<ConnectorId, "stripe">, BillingConnector> = {
  mercado_pago: new MercadoPagoConnector(),
  abacatepay: new AbacatePayConnector(),
  asaas: new AsaasConnector(),
}

export type ApiConnectorId = keyof typeof registry

export const API_CONNECTOR_IDS = Object.keys(registry) as ApiConnectorId[]

export function isApiConnectorId(value: unknown): value is ApiConnectorId {
  return typeof value === "string" && Object.hasOwn(registry, value)
}

export function billingConnector(id: ApiConnectorId): BillingConnector {
  return registry[id]
}
