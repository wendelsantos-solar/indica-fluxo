import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { StripeAdapter } = await import("../adapter")

const adapter = new StripeAdapter()

function normalize(type: string, object: Record<string, unknown>, livemode = false) {
  return adapter.normalizeEvent({
    providerEventId: "evt_1",
    rawType: type,
    providerAccountId: null,
    environment: livemode ? "live" : "test",
    payload: { id: "evt_1", type, created: 1_760_000_000, livemode, data: { object } },
  })
}

describe("StripeAdapter — environment", () => {
  const invoice = { id: "in_env", amount_paid: 100, currency: "brl", customer: "cus_env" }

  it("routes a test-mode event to the test ledger", () => {
    expect(normalize("invoice.paid", invoice, false)).toMatchObject({ environment: "test" })
  })

  it("routes a live-mode event to the live ledger", () => {
    expect(normalize("invoice.paid", invoice, true)).toMatchObject({ environment: "live" })
    expect(normalize("refund.created", { id: "re_env", amount: 100, currency: "brl", charge: "ch_env", status: "succeeded" }, true)).toMatchObject({
      environment: "live",
    })
  })
})

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

  it("reads a won dispute (or a closed inquiry) as money given back, and ignores a lost one", () => {
    const dispute = { id: "dp_3", amount: 4900, currency: "brl", charge: "ch_3", payment_intent: "pi_3" }
    expect(normalize("charge.dispute.closed", { ...dispute, status: "won" })).toMatchObject({
      type: "payment.disputeWon",
      providerDisputeId: "dp_3",
      paymentReferences: ["pi_3", "ch_3"],
    })
    expect(normalize("charge.dispute.closed", { ...dispute, status: "warning_closed" })).toMatchObject({
      type: "payment.disputeWon",
    })
    expect(normalize("charge.dispute.closed", { ...dispute, status: "lost" })).toBeNull()
  })

  it("no longer reads charge.refunded, whose amount is the charge's running total", () => {
    expect(normalize("charge.refunded", { id: "ch_1", amount_refunded: 1000, currency: "brl" })).toBeNull()
  })
})

describe("StripeAdapter — attribution references", () => {
  const TOKEN = `ifx_${"aB3-_".repeat(8)}`.slice(0, 47)

  it("turns a Checkout Session with our client_reference_id into a bind, never into money", () => {
    const event = normalize("checkout.session.completed", {
      id: "cs_1",
      mode: "subscription",
      client_reference_id: TOKEN,
      customer: "cus_1",
      subscription: "sub_1",
    })
    expect(event).toMatchObject({
      type: "attribution.bind",
      attributionToken: TOKEN,
      providerCustomerId: "cus_1",
      providerSubscriptionId: "sub_1",
    })
    // The invoice or PaymentIntent event records the payment; this one must not.
    expect(event).not.toHaveProperty("amountMinor")
  })

  it("falls back to session metadata when client_reference_id holds the founder's own id", () => {
    expect(
      normalize("checkout.session.completed", {
        id: "cs_2",
        mode: "payment",
        client_reference_id: "cart_9182",
        metadata: { indicafluxo_ref: TOKEN },
        customer: "cus_2",
      }),
    ).toMatchObject({ type: "attribution.bind", attributionToken: TOKEN, providerCustomerId: "cus_2" })
  })

  it("ignores a session with no reference of ours, and one with no customer", () => {
    expect(
      normalize("checkout.session.completed", { id: "cs_3", client_reference_id: "cart_1", customer: "cus_3" }),
    ).toBeNull()
    expect(
      normalize("checkout.session.completed", { id: "cs_4", client_reference_id: TOKEN, customer: null }),
    ).toBeNull()
  })

  it("reads the reference from PaymentIntent metadata (Elements / custom checkout)", () => {
    expect(
      normalize("payment_intent.succeeded", {
        id: "pi_m",
        amount: 4900,
        amount_received: 4900,
        currency: "brl",
        customer: "cus_m",
        metadata: { indicafluxo_ref: TOKEN },
      }),
    ).toMatchObject({ type: "payment.succeeded", attributionToken: TOKEN })
  })

  it("reads the reference from the subscription an invoice belongs to (Subscription API)", () => {
    expect(
      normalize("invoice.paid", {
        id: "in_m",
        amount_paid: 4900,
        currency: "brl",
        customer: "cus_m",
        parent: { subscription_details: { subscription: "sub_m", metadata: { indicafluxo_ref: TOKEN } } },
      }),
    ).toMatchObject({ type: "payment.succeeded", attributionToken: TOKEN })
  })

  it("reads the reference from the subscription itself", () => {
    expect(
      normalize("customer.subscription.created", {
        id: "sub_n",
        customer: "cus_n",
        status: "active",
        currency: "brl",
        metadata: { indicafluxo_ref: TOKEN },
        items: { data: [{ price: { unit_amount: 4900, recurring: { interval: "month" } } }] },
        start_date: 1_760_000_000,
      }),
    ).toMatchObject({ type: "subscription.updated", attributionToken: TOKEN })
  })

  it("leaves a payment without a reference exactly as it was", () => {
    expect(
      normalize("payment_intent.succeeded", { id: "pi_p", amount: 100, currency: "brl", customer: "cus_p" }),
    ).toMatchObject({ type: "payment.succeeded", attributionToken: null })
  })
})
