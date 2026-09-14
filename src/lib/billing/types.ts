/**
 * The boundary between "a billing provider" and "our domain".
 *
 * Nothing below carries a provider SDK type. The commission engine only ever
 * sees a `NormalizedBillingEvent`, which is why adding Paddle later is one new
 * folder and one registry entry — see ARCHITECTURE.md §4.
 */

export type BillingProviderId = "stripe" | "paddle" | "manual"

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

interface BaseEvent {
  provider: BillingProviderId
  providerEventId: string
  /** The provider's own event name, kept for auditing. */
  rawType: string
  occurredAt: Date
  /** The connected account this event belongs to. */
  providerAccountId: string | null
}

export interface PaymentSucceededEvent extends BaseEvent {
  type: "payment.succeeded"
  providerTransactionId: string
  providerCustomerId: string | null
  providerSubscriptionId: string | null
  customerEmail: string | null
  currency: string
  amountMinor: number
}

export interface PaymentRefundedEvent extends BaseEvent {
  type: "payment.refunded"
  providerTransactionId: string
  /** The payment being refunded. */
  providerParentTransactionId: string | null
  providerCustomerId: string | null
  currency: string
  /** Positive magnitude; the engine applies the sign. */
  amountMinor: number
  isChargeback: boolean
}

export interface SubscriptionUpdatedEvent extends BaseEvent {
  type: "subscription.updated"
  subscription: ProviderSubscription
  customerEmail: string | null
}

export interface SubscriptionCancelledEvent extends BaseEvent {
  type: "subscription.cancelled"
  providerSubscriptionId: string
  providerCustomerId: string | null
  cancelledAt: Date
}

export type NormalizedBillingEvent =
  | PaymentSucceededEvent
  | PaymentRefundedEvent
  | SubscriptionUpdatedEvent
  | SubscriptionCancelledEvent

export interface VerifiedWebhook {
  providerEventId: string
  rawType: string
  providerAccountId: string | null
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
