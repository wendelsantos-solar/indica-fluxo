import { pgEnum } from "drizzle-orm/pg-core"

export const workspaceRoleEnum = pgEnum("workspace_role", ["owner", "admin", "member"])

/**
 * The plan codes of Refvia's own offer. What each includes lives in code
 * (`src/lib/plans.ts`), the single source enforcement reads; see docs/PLANS.md.
 * `scale` exists so the model accepts a third plan; it is not sold yet.
 */
export const planCodeEnum = pgEnum("plan_code", ["sandbox", "launch", "growth", "scale"])

/** State of a workspace's subscription to Refvia (not its customers'). */
export const platformSubscriptionStatusEnum = pgEnum("platform_subscription_status", [
  "free",
  "trialing",
  "active",
  "past_due",
  "cancelled",
  "incomplete",
])

/**
 * Test or live data. Carried by programs (and everything hanging off them),
 * API keys, customers, transactions and payout batches, so a sandbox never
 * touches the live ledger and a Stripe test event never pays anyone.
 */
export const environmentEnum = pgEnum("environment", ["test", "live"])

/** Whose webhook: a founder's billing (their customers) or Refvia's own. */
export const webhookScopeEnum = pgEnum("webhook_scope", ["customer_billing", "platform_billing"])

export const programStatusEnum = pgEnum("program_status", [
  "draft",
  "active",
  "paused",
  "archived",
])

/**
 * `percentage` stores basis points in `commission_value` (3000 = 30%).
 * `fixed` stores minor units (1000 = $10.00). See DATABASE.md §1.
 */
export const commissionTypeEnum = pgEnum("commission_type", ["percentage", "fixed"])

export const attributionModelEnum = pgEnum("attribution_model", ["first_click", "last_click"])

export const affiliateStatusEnum = pgEnum("affiliate_status", [
  "invited",
  "active",
  "suspended",
])

export const programAffiliateStatusEnum = pgEnum("program_affiliate_status", [
  "pending",
  "approved",
  "rejected",
  "suspended",
])

/**
 * Every billing provider a connection, customer identity or transaction can
 * belong to. `paddle` is reserved and unused; `manual` is the sandbox. The
 * connectors themselves live in `src/lib/billing/` (catalog + registry).
 */
export const billingProviderEnum = pgEnum("billing_provider", [
  "stripe",
  "paddle",
  "manual",
  "mercado_pago",
  "abacatepay",
  "asaas",
])

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "cancelled",
  "incomplete",
])

export const subscriptionIntervalEnum = pgEnum("subscription_interval", [
  "day",
  "week",
  "month",
  "year",
  "one_time",
])

export const transactionTypeEnum = pgEnum("transaction_type", [
  "payment",
  "refund",
  "chargeback",
  "adjustment",
])

export const transactionStatusEnum = pgEnum("transaction_status", [
  "succeeded",
  "pending",
  "failed",
])

export const commissionStatusEnum = pgEnum("commission_status", [
  "pending",
  "available",
  "approved",
  "paid",
  "reversed",
  "rejected",
])

export const payoutBatchStatusEnum = pgEnum("payout_batch_status", [
  "draft",
  "approved",
  "paid",
  "cancelled",
])

export const payoutItemStatusEnum = pgEnum("payout_item_status", [
  "pending",
  "paid",
  "failed",
  "cancelled",
])

/**
 * What the founder configured, not whether it works — health is derived from
 * evidence (`src/features/integrations/health.ts`). `pending`: being set up,
 * nothing confirmed by the provider yet (migration 0018).
 */
export const integrationStatusEnum = pgEnum("integration_status", [
  "connected",
  "disconnected",
  "error",
  "pending",
])

export const apiKeyTypeEnum = pgEnum("api_key_type", ["publishable", "secret"])

export const webhookStatusEnum = pgEnum("webhook_status", [
  "received",
  "processed",
  "failed",
  "ignored",
])

export const deviceTypeEnum = pgEnum("device_type", ["desktop", "mobile", "tablet", "unknown"])
