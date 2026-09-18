import type { BillingProviderId } from "./types"

/**
 * The provider customer id as `attributions.provider_customer_id` and
 * `attribution_tokens.bound_provider_customer_id` store it.
 *
 * Those two columns predate multi-provider and hold a bare id. Stripe ids (and
 * the sandbox's `manual` ids) keep being stored bare — every existing row and
 * integration depends on that. Every other provider's id is namespaced, so a
 * Mercado Pago payer "123" can never match a Stripe customer "123"
 * (UNIVERSAL_ATTRIBUTION_ARCHITECTURE.md §2, brief §79).
 */
export function attributionCustomerKey(provider: BillingProviderId, providerCustomerId: string): string {
  return provider === "stripe" || provider === "manual" || provider === "paddle"
    ? providerCustomerId
    : `${provider}:${providerCustomerId}`
}

/**
 * The identity a payment gets when its provider named no customer but it
 * carried a reference (guest checkout, Flow B): the payment itself. It is only
 * ever used for that one payment's attribution and its refunds.
 */
export function guestCustomerId(providerTransactionId: string): string {
  return `guest:${providerTransactionId}`
}
