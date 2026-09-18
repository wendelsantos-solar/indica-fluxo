/**
 * The boundary between "a billing provider" and "our domain".
 *
 * Nothing below carries a provider SDK type. The commission engine only ever
 * sees a `NormalizedBillingEvent`, which is why adding Paddle later is one new
 * folder and one registry entry — see ARCHITECTURE.md §4.
 */

export type BillingProviderId = "stripe" | "paddle" | "manual" | "mercado_pago" | "abacatepay" | "asaas"

/** Every id, in the order of the database enum (`billing_provider`). */
export const BILLING_PROVIDER_IDS = ["stripe", "paddle", "manual", "mercado_pago", "abacatepay", "asaas"] as const

/**
 * Test or live money, from the provider's own flag (Stripe `livemode`). A test
 * event only ever reaches test programs, customers and transactions; a live
 * one only live ones (docs/PLANS.md §2).
 */
export type BillingEnvironment = "test" | "live"

export interface ProviderAccount {
  providerAccountId: string
  displayName?: string
  /** Non-sensitive only. Never tokens. */
  metadata?: Record<string, unknown>
}

export interface ProviderCustomer {
  providerCustomerId: string
  email?: string
  externalId?: string
  createdAt: Date
}

export interface ProviderSubscription {
  providerSubscriptionId: string
  providerCustomerId: string
  status: "trialing" | "active" | "past_due" | "cancelled" | "incomplete"
  currency: string
  amountMinor: number
  interval: "day" | "week" | "month" | "year" | "one_time"
  startedAt: Date
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  cancelledAt: Date | null
}

/** The fields every normalized event carries, whatever its type. */
export interface BillingEventBase {
  provider: BillingProviderId
  providerEventId: string
  /** The provider's own event name, kept for auditing. */
  rawType: string
  occurredAt: Date
  /** The connected account this event belongs to. */
  providerAccountId: string | null
  /** Which ledger the event belongs to. Never inferred: it comes from the provider. */
  environment: BillingEnvironment
}

export interface PaymentSucceededEvent extends BillingEventBase {
  type: "payment.succeeded"
  /**
   * The public attribution reference the checkout carried, when it did
   * (`metadata[indicafluxo_ref]` on a PaymentIntent, a Subscription or an
   * invoice). First step of the resolution order — see
   * INTEGRATION_ARCHITECTURE_V2.md §3.
   */
  attributionToken?: string | null
  /** The id the payment is recorded under: the invoice, or the one-off PaymentIntent. */
  providerTransactionId: string
  /**
   * Other provider ids of this same payment that a later refund or dispute may
   * carry instead (PaymentIntent, charge). Only what the payload holds.
   */
  providerReferences: string[]
  providerCustomerId: string | null
  providerSubscriptionId: string | null
  customerEmail: string | null
  currency: string
  amountMinor: number
  /**
   * The SaaS's own customer id, when the checkout carried it in server-set
   * metadata (`metadata[indicafluxo_customer]`). Never read from a field a
   * browser can set. Links this provider's customer to an existing Customer —
   * the provider-switch path (UNIVERSAL_ATTRIBUTION_ARCHITECTURE.md §3).
   */
  externalCustomerId?: string | null
}

export interface PaymentRefundedEvent extends BillingEventBase {
  type: "payment.refunded"
  /** The refund (`re_…`) or dispute (`dp_…`) itself, so each partial refund is its own row. */
  providerTransactionId: string
  /** Every id the refunded payment may be known by (PaymentIntent, charge, invoice). */
  paymentReferences: string[]
  providerCustomerId: string | null
  currency: string
  /** Positive magnitude; the engine applies the sign. */
  amountMinor: number
  isChargeback: boolean
  /**
   * Set by providers that report the running refunded TOTAL of a payment rather
   * than each refund (Mercado Pago `transaction_amount_refunded`, Asaas
   * `refunds[]`). The core then records only the part not recorded yet; the
   * adapter stays stateless and does no arithmetic on the ledger.
   */
  cumulativeRefundedMinor?: number
}

/**
 * A dispute closed in the merchant's favour (Stripe `charge.dispute.closed`,
 * `won` — or `warning_closed` for an inquiry, whose funds were never taken).
 * Undoes what its `payment.refunded` chargeback reversed.
 */
export interface DisputeWonEvent extends BillingEventBase {
  type: "payment.disputeWon"
  /** The dispute (`dp_…`) — the id its chargeback was recorded under. */
  providerDisputeId: string
  /** Every id the disputed payment may be known by (PaymentIntent, charge). */
  paymentReferences: string[]
}

/**
 * Links ids of one payment without moving money — Stripe's `invoice_payment.paid`
 * says which PaymentIntent and charge paid an invoice. It may arrive before or
 * after the invoice payment itself.
 */
export interface PaymentReferencedEvent extends BillingEventBase {
  type: "payment.referenced"
  providerTransactionId: string
  providerReferences: string[]
}

export interface SubscriptionUpdatedEvent extends BillingEventBase {
  type: "subscription.updated"
  subscription: ProviderSubscription
  customerEmail: string | null
  /** `metadata[indicafluxo_ref]` on the subscription (Subscription API flow). */
  attributionToken?: string | null
  /** See `PaymentSucceededEvent.externalCustomerId`. */
  externalCustomerId?: string | null
}

/**
 * A charge that did not go through (card refused, Pix expired, subscription
 * retry failed). Moves no money and never creates a transaction: it is recorded
 * on the event row (`PAYMENT_FAILED`) so diagnostics can show it.
 */
export interface PaymentFailedEvent extends BillingEventBase {
  type: "payment.failed"
  providerTransactionId: string
  providerCustomerId: string | null
  /** The provider's own status detail, sanitized to a short code. */
  reason: string | null
}

/**
 * A checkout said who its customer is and carried an attribution reference —
 * Stripe's `checkout.session.completed`, for hosted Checkout and for Payment
 * Links (INTEGRATION_ARCHITECTURE_V2.md §4, strategies A and B).
 *
 * It moves no money and **must never create a transaction**: the invoice or
 * PaymentIntent event records the payment. Its only job is to bind the
 * visitor's attribution to the provider customer, which is what makes
 * `POST /api/identify` optional.
 */
export interface AttributionBindEvent extends BillingEventBase {
  type: "attribution.bind"
  /** `null` when the checkout carried only the SaaS's customer id. */
  attributionToken: string | null
  providerCustomerId: string
  providerSubscriptionId: string | null
  /** See `PaymentSucceededEvent.externalCustomerId`. At least one of the two is set. */
  externalCustomerId?: string | null
}

export interface SubscriptionCancelledEvent extends BillingEventBase {
  type: "subscription.cancelled"
  providerSubscriptionId: string
  providerCustomerId: string | null
  cancelledAt: Date
}

export type NormalizedBillingEvent =
  | PaymentSucceededEvent
  | PaymentRefundedEvent
  | DisputeWonEvent
  | PaymentReferencedEvent
  | SubscriptionUpdatedEvent
  | SubscriptionCancelledEvent
  | AttributionBindEvent
  | PaymentFailedEvent

export interface VerifiedWebhook {
  providerEventId: string
  rawType: string
  providerAccountId: string | null
  /** From the provider's live/test flag; `null` when the provider has none. */
  environment: BillingEnvironment | null
  /** Opaque to callers: only the owning adapter may interpret it. */
  payload: unknown
}

export interface BillingProvider {
  readonly id: BillingProviderId

  /** Throws when the signature does not verify. Never parses before verifying. */
  verifyWebhook(rawBody: string, signature: string): Promise<VerifiedWebhook>

  /** `null` means "a valid event we deliberately ignore". */
  normalizeEvent(webhook: VerifiedWebhook): NormalizedBillingEvent | null

  getCustomer(
    providerAccountId: string,
    providerCustomerId: string,
  ): Promise<ProviderCustomer | null>

  getSubscription(
    providerAccountId: string,
    providerSubscriptionId: string,
  ): Promise<ProviderSubscription | null>

  /** OAuth entry point, so we hold an account id rather than a secret key. */
  buildConnectUrl(params: { state: string; redirectUri: string }): string

  exchangeConnectCode(code: string): Promise<ProviderAccount>
}
