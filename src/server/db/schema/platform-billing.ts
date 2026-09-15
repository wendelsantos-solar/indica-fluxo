import { relations, sql } from "drizzle-orm"
import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"

import { billingProviderEnum, planCodeEnum, platformSubscriptionStatusEnum } from "./enums"
import { workspaces } from "./tenancy"

/**
 * A workspace's subscription to IndicaFluxo itself. Not `subscriptions`, which
 * records the founders' own customers' subscriptions read from their Stripe.
 *
 * At most one row per workspace. No row means Sandbox. Written only by the
 * platform-billing webhook (service connection) and by the operator for
 * `provider = 'manual'` agreements; `indica_app` may only read it (migration
 * 0010). What a plan allows is resolved in code — `src/lib/plans.ts`.
 */
export const workspaceSubscriptions = pgTable(
  "workspace_subscriptions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),

    plan: planCodeEnum("plan").notNull().default("sandbox"),
    status: platformSubscriptionStatusEnum("status").notNull().default("free"),

    /** `stripe` for Checkout subscriptions, `manual` for operator agreements. */
    provider: billingProviderEnum("provider"),
    providerCustomerId: text("provider_customer_id"),
    providerSubscriptionId: text("provider_subscription_id"),
    providerPriceId: text("provider_price_id"),

    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),

    trialStartedAt: timestamp("trial_started_at", { withTimezone: true }),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    /** Set when the status becomes `past_due`; the grace period counts from here. */
    pastDueSince: timestamp("past_due_since", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),

    /**
     * `created` of the newest provider event applied. Stripe does not deliver
     * in order; an older event never overwrites a newer state.
     */
    providerEventAt: timestamp("provider_event_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("workspace_subscriptions_workspace_key").on(t.workspaceId),
    uniqueIndex("workspace_subscriptions_provider_subscription_key")
      .on(t.provider, t.providerSubscriptionId)
      .where(sql`provider_subscription_id is not null`),
    uniqueIndex("workspace_subscriptions_provider_customer_key")
      .on(t.provider, t.providerCustomerId)
      .where(sql`provider_customer_id is not null`),
  ],
)

export const workspaceSubscriptionsRelations = relations(workspaceSubscriptions, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceSubscriptions.workspaceId],
    references: [workspaces.id],
  }),
}))
