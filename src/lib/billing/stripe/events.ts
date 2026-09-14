/**
 * Stripe event types the adapter turns into ledger facts, and what each one
 * records. Framework- and SDK-free so the integration guide can list exactly
 * these; a test checks the list against the adapter's `switch`
 * (`src/features/docs/__tests__/snippets.test.ts`).
 */
export const STRIPE_HANDLED_EVENTS = [
  { type: "invoice.payment_succeeded", records: "payment" },
  { type: "invoice.paid", records: "payment" },
  { type: "payment_intent.succeeded", records: "oneOffPayment" },
  { type: "charge.refunded", records: "refund" },
  { type: "charge.dispute.created", records: "chargeback" },
  { type: "customer.subscription.created", records: "subscription" },
  { type: "customer.subscription.updated", records: "subscription" },
  { type: "customer.subscription.deleted", records: "subscriptionCancelled" },
] as const

export type StripeEventRecord = (typeof STRIPE_HANDLED_EVENTS)[number]["records"]
