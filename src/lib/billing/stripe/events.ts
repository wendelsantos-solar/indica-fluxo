/**
 * Stripe event types the adapter turns into ledger facts, and what each one
 * records. Framework- and SDK-free so the integration guide can list exactly
 * these; a test checks the list against the adapter's `switch`
 * (`src/features/docs/__tests__/snippets.test.ts`).
 */
export const STRIPE_HANDLED_EVENTS = [
  { type: "checkout.session.completed", records: "checkoutReference" },
  { type: "invoice.payment_succeeded", records: "payment" },
  { type: "invoice.paid", records: "payment" },
  { type: "payment_intent.succeeded", records: "oneOffPayment" },
  { type: "invoice_payment.paid", records: "paymentLink" },
  { type: "refund.created", records: "refund" },
  { type: "charge.dispute.created", records: "chargeback" },
  { type: "charge.dispute.closed", records: "disputeWon" },
  { type: "customer.subscription.created", records: "subscription" },
  { type: "customer.subscription.updated", records: "subscription" },
  { type: "customer.subscription.deleted", records: "subscriptionCancelled" },
] as const

export type StripeEventRecord = (typeof STRIPE_HANDLED_EVENTS)[number]["records"]

/**
 * Where Stripe delivers events for one integration. Each workspace has its own
 * endpoint so each can be verified with that endpoint's own signing secret
 * (DOCS_TECHNICAL_FINDINGS.md T1).
 */
export function stripeWebhookPath(integrationId: string): string {
  return `/api/webhooks/stripe/${integrationId}`
}

/** Prefix of a Stripe endpoint signing secret, as shown in the Stripe dashboard. */
export const STRIPE_WEBHOOK_SECRET_PREFIX = "whsec_"
