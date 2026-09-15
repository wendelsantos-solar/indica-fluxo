import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { StripeAdapter } = await import("../adapter")

const adapter = new StripeAdapter()

function normalize(type: string, object: Record<string, unknown>) {
  return adapter.normalizeEvent({
    providerEventId: "evt_1",
    rawType: type,
    providerAccountId: null,
    payload: { id: "evt_1", type, created: 1_760_000_000, data: { object } },
  })
}

describe("StripeAdapter — payment references (T6)", () => {
  it("records an invoice payment under the invoice, with the ids of an expanded payment", () => {
    const event = normalize("invoice.paid", {
      id: "in_1",
      amount_paid: 4900,
      currency: "brl",
      customer: "cus_1",
      customer_email: "Ana@Example.com",
      parent: { subscription_details: { subscription: "sub_1" } },
      payments: { data: [{ payment: { type: "payment_intent", payment_intent: "pi_1", charge: "ch_1" } }] },
    })
    expect(event).toMatchObject({
      type: "payment.succeeded",
      providerTransactionId: "in_1",
      providerReferences: ["pi_1", "ch_1"],
      providerSubscriptionId: "sub_1",
      customerEmail: "Ana@Example.com",
      currency: "BRL",
    })
  })

  it("turns invoice_payment.paid into a link between the invoice and its PaymentIntent and charge", () => {
    const event = normalize("invoice_payment.paid", {
      id: "inpay_1",
      invoice: "in_1",
      payment: { type: "payment_intent", payment_intent: "pi_1", charge: "ch_1" },
    })
    expect(event).toMatchObject({ type: "payment.referenced", providerTransactionId: "in_1", providerReferences: ["pi_1", "ch_1"] })
  })

  it("records a one-off PaymentIntent with its latest charge as a reference", () => {
    const event = normalize("payment_intent.succeeded", {
      id: "pi_2",
      amount: 1000,
      amount_received: 1000,
      currency: "usd",
      customer: "cus_2",
      latest_charge: "ch_2",
      receipt_email: null,
    })
    expect(event).toMatchObject({ providerTransactionId: "pi_2", providerReferences: ["ch_2"] })
  })

  it("uses the refund's own id and amount, so each partial refund is its own row", () => {
    const event = normalize("refund.created", {
      id: "re_1",
      amount: 1000,
      currency: "brl",
      charge: "ch_1",
      payment_intent: "pi_1",
      customer: "cus_1",
      status: "succeeded",
    })
    expect(event).toMatchObject({
      type: "payment.refunded",
      providerTransactionId: "re_1",
      paymentReferences: ["pi_1", "ch_1"],
      amountMinor: 1000,
      isChargeback: false,
    })
  })

  it("ignores a failed refund", () => {
    expect(normalize("refund.created", { id: "re_2", amount: 1000, currency: "brl", charge: "ch_1", payment_intent: "pi_1", status: "failed" })).toBeNull()
  })

  it("matches a dispute on an invoice payment through its PaymentIntent and charge", () => {
    const event = normalize("charge.dispute.created", {
      id: "dp_1",
      amount: 4900,
      currency: "brl",
      charge: "ch_1",
      payment_intent: "pi_1",
    })
    expect(event).toMatchObject({
      type: "payment.refunded",
      providerTransactionId: "dp_1",
      paymentReferences: ["pi_1", "ch_1"],
      isChargeback: true,
    })
  })

  it("matches a dispute on a charge without a PaymentIntent by the charge alone", () => {
    const event = normalize("charge.dispute.created", { id: "dp_2", amount: 500, currency: "usd", charge: "ch_9", payment_intent: null })
    expect(event).toMatchObject({ providerTransactionId: "dp_2", paymentReferences: ["ch_9"] })
  })

  it("no longer reads charge.refunded, whose amount is the charge's running total", () => {
    expect(normalize("charge.refunded", { id: "ch_1", amount_refunded: 1000, currency: "brl" })).toBeNull()
  })
})
