/**
 * Sanitized provider payloads for the connector contract tests, shaped after
 * the official documentation's examples (BILLING_PROVIDER_MATRIX.md). Every
 * id, amount and e-mail is synthetic; no real payload is committed.
 */

export const FIXTURE_TOKEN = `ifx_${"Fx7".repeat(14)}Q`

export const mercadoPago = {
  notification: (paymentId: string, notificationId = "12345678901") => ({
    id: notificationId,
    live_mode: true,
    type: "payment",
    date_created: "2026-09-01T12:00:00Z",
    user_id: "44444444",
    api_version: "v1",
    action: "payment.updated",
    data: { id: paymentId },
  }),
  payment: (overrides: Record<string, unknown> = {}) => ({
    id: 1_000_000_001,
    status: "approved",
    status_detail: "accredited",
    transaction_amount: 94.51,
    transaction_amount_refunded: 0,
    currency_id: "BRL",
    external_reference: FIXTURE_TOKEN,
    metadata: { indicafluxo_customer: "user_42" },
    live_mode: true,
    date_approved: "2026-09-01T12:00:00.000-03:00",
    date_created: "2026-09-01T11:59:00.000-03:00",
    operation_type: "regular_payment",
    payer: { id: "900001", email: "payer@example.test" },
    ...overrides,
  }),
}

export const abacatePay = {
  completed: (overrides: Record<string, unknown> = {}) => ({
    id: "log_fixture_0001",
    event: "checkout.completed",
    apiVersion: 2,
    devMode: false,
    data: {
      checkout: {
        id: "bill_fixture_0001",
        externalId: FIXTURE_TOKEN,
        amount: 4990,
        paidAmount: 4990,
        platformFee: 80,
        status: "PAID",
        customerId: "cust_fixture_0001",
        frequency: "ONE_TIME",
        ...overrides,
      },
      customer: { id: "cust_fixture_0001" },
    },
  }),
  refunded: () => ({
    id: "log_fixture_0002",
    event: "checkout.refunded",
    apiVersion: 2,
    devMode: false,
    data: {
      checkout: { id: "bill_fixture_0001", amount: 4990, paidAmount: 4990, customerId: "cust_fixture_0001" },
      reason: "requested_by_customer",
    },
  }),
  renewed: () => ({
    id: "log_fixture_0003",
    event: "subscription.renewed",
    apiVersion: 2,
    devMode: true,
    data: {
      subscription: { id: "subs_fixture_0001", amount: 2990, frequency: "MONTHLY", customerId: "cust_fixture_0002" },
      payment: { id: "char_fixture_0002", amount: 2990, paidAmount: 2990 },
      checkout: { id: "bill_fixture_0002", externalId: null, customerId: "cust_fixture_0002" },
    },
  }),
  unknown: () => ({ id: "log_fixture_0004", event: "payout.completed", apiVersion: 2, devMode: false, data: {} }),
}

export const asaas = {
  payment: (event: string, overrides: Record<string, unknown> = {}) => ({
    id: `evt_fixture_${event}&368604920`,
    event,
    dateCreated: "2026-09-01 12:00:00",
    payment: {
      object: "payment",
      id: "pay_fixture_0001",
      customer: "cus_fixture_0001",
      subscription: null,
      value: 149.9,
      netValue: 145.2,
      billingType: "PIX",
      status: "RECEIVED",
      externalReference: FIXTURE_TOKEN,
      dateCreated: "2026-09-01",
      paymentDate: "2026-09-01",
      refunds: null,
      ...overrides,
    },
  }),
  subscription: (event: string) => ({
    id: `evt_fixture_${event}&1`,
    event,
    dateCreated: "2026-09-01 12:00:00",
    subscription: {
      object: "subscription",
      id: "sub_fixture_0001",
      customer: "cus_fixture_0002",
      value: 59.9,
      cycle: "MONTHLY",
      status: event === "SUBSCRIPTION_INACTIVATED" ? "INACTIVE" : "ACTIVE",
      externalReference: FIXTURE_TOKEN,
      dateCreated: "2026-09-01",
    },
  }),
}
