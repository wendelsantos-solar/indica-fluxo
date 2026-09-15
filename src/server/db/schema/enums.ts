import { pgEnum } from "drizzle-orm/pg-core"

export const workspaceRoleEnum = pgEnum("workspace_role", ["owner", "admin", "member"])

/** Commercial plan of a workspace. Limits live in `src/lib/plans.ts`. */
export const workspacePlanEnum = pgEnum("workspace_plan", ["starter", "growth"])

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

export const billingProviderEnum = pgEnum("billing_provider", ["stripe", "paddle", "manual"])

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

export const integrationStatusEnum = pgEnum("integration_status", [
  "connected",
  "disconnected",
  "error",
])

export const apiKeyTypeEnum = pgEnum("api_key_type", ["publishable", "secret"])

export const webhookStatusEnum = pgEnum("webhook_status", [
  "received",
  "processed",
  "failed",
  "ignored",
])

export const deviceTypeEnum = pgEnum("device_type", ["desktop", "mobile", "tablet", "unknown"])
