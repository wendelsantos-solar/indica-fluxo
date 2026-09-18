import { relations, sql } from "drizzle-orm"
import {
  bigint,
  char,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import {
  billingProviderEnum,
  environmentEnum,
  subscriptionIntervalEnum,
  subscriptionStatusEnum,
  transactionStatusEnum,
  transactionTypeEnum,
} from "./enums"
import { integrations } from "./platform"
import { programs } from "./programs"
import { workspaces } from "./tenancy"

/** The SaaS client's customers — never our own users. Only an e-mail hash. */
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    programId: uuid("program_id").references(() => programs.id, { onDelete: "set null" }),

    externalId: text("external_id"),
    /**
     * A founder's staging and production apps usually share user ids; test and
     * live customers are separate rows so a test identify never attaches a
     * Stripe test customer id to a live customer.
     */
    environment: environmentEnum("environment").notNull().default("test"),
    provider: billingProviderEnum("provider").notNull(),
    providerCustomerId: text("provider_customer_id"),

    emailHash: text("email_hash"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("customers_workspace_provider_customer_key")
      .on(t.workspaceId, t.environment, t.provider, t.providerCustomerId)
      .where(sql`provider_customer_id is not null`),
    uniqueIndex("customers_workspace_external_key")
      .on(t.workspaceId, t.environment, t.externalId)
      .where(sql`external_id is not null`),
    index("customers_workspace_idx").on(t.workspaceId, t.createdAt.desc()),
    // Payment → customer fallback by identified e-mail hash (billing-events
    // `identifiedCustomerByEmail`); otherwise a scan of every tenant's customers.
    index("customers_email_hash_idx")
      .on(t.workspaceId, t.environment, t.emailHash)
      .where(sql`email_hash is not null`),
  ],
)

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),

    provider: billingProviderEnum("provider").notNull(),
    providerSubscriptionId: text("provider_subscription_id").notNull(),

    status: subscriptionStatusEnum("status").notNull(),

    currency: char("currency", { length: 3 }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    interval: subscriptionIntervalEnum("interval").notNull().default("month"),

    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("subscriptions_provider_key").on(t.provider, t.providerSubscriptionId),
    index("subscriptions_customer_idx").on(t.customerId),
    index("subscriptions_workspace_status_idx").on(t.workspaceId, t.status),
  ],
)

/**
 * Money that actually moved. The UNIQUE on (workspace, provider, provider id)
 * is the second idempotency barrier behind `webhook_events`.
 */
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),

    provider: billingProviderEnum("provider").notNull(),
    providerTransactionId: text("provider_transaction_id").notNull(),
    /** For refunds: the provider id of the payment being refunded. */
    providerParentTransactionId: text("provider_parent_transaction_id"),

    type: transactionTypeEnum("type").notNull(),
    status: transactionStatusEnum("status").notNull().default("succeeded"),
    /** From the provider event (Stripe `livemode`). */
    environment: environmentEnum("environment").notNull().default("test"),
    /** The connection that delivered it (migration 0018); NULL before, and for simulations. */
    integrationId: uuid("integration_id").references(() => integrations.id, { onDelete: "set null" }),

    currency: char("currency", { length: 3 }).notNull(),
    grossAmountMinor: bigint("gross_amount_minor", { mode: "number" }).notNull(),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("transactions_provider_key").on(
      t.workspaceId,
      t.provider,
      t.providerTransactionId,
    ),
    index("transactions_workspace_time_idx").on(t.workspaceId, t.occurredAt.desc()),
    index("transactions_customer_idx").on(t.customerId),
    index("transactions_subscription_idx").on(t.subscriptionId),
    index("transactions_parent_idx")
      .on(t.providerParentTransactionId)
      .where(sql`provider_parent_transaction_id is not null`),
  ],
)

/**
 * Every provider id that names the same payment. Stripe stores a subscription
 * payment as an invoice (`in_…`) while a refund or dispute only carries the
 * PaymentIntent (`pi_…`) and charge (`ch_…`); this maps each of those ids to
 * the `provider_transaction_id` the payment was recorded under.
 *
 * Keyed by provider id rather than by `transactions.id` on purpose: Stripe does
 * not order its events, and the link between an invoice and its PaymentIntent
 * (`invoice_payment.paid`) can arrive before the invoice payment itself.
 * Written only by the webhook ingest path.
 */
export const transactionReferences = pgTable(
  "transaction_references",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: billingProviderEnum("provider").notNull(),
    /** `pi_…`, `ch_…`, `in_…` — any id a later refund or dispute may carry. */
    referenceId: text("reference_id").notNull(),
    /** The id the payment row is stored under (`transactions.provider_transaction_id`). */
    providerTransactionId: text("provider_transaction_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("transaction_references_key").on(t.workspaceId, t.provider, t.referenceId),
  ],
)

/**
 * One customer, N provider identities (UNIVERSAL_ATTRIBUTION_ARCHITECTURE.md §2).
 *
 * "This Stripe `cus_…`, this Mercado Pago payer and this Asaas `cus_…` are the
 * same customer of the SaaS." The provider is part of the key — Stripe "123" and
 * Mercado Pago "123" are two identities — the account is not, because every
 * supported provider issues global customer ids and a Stripe per-workspace
 * endpoint does not always say which account an event came from.
 *
 * Written only on the service connection (webhook ingest, POST /api/identify),
 * through `linkBillingIdentity` — the one writer. `customers.provider /
 * provider_customer_id` keep being written too (dual write) until nothing reads
 * them (MULTI_PROVIDER_INTEGRATION_AUDIT.md, MIGRATION_RISK).
 */
export const billingIdentities = pgTable(
  "billing_identities",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    environment: environmentEnum("environment").notNull(),
    provider: billingProviderEnum("provider").notNull(),
    providerCustomerId: text("provider_customer_id").notNull(),
    /** The connection that first saw it. Provenance only; not part of the key. */
    integrationId: uuid("integration_id").references(() => integrations.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("billing_identities_provider_customer_key").on(
      t.workspaceId,
      t.environment,
      t.provider,
      t.providerCustomerId,
    ),
    index("billing_identities_customer_idx").on(t.customerId),
  ],
)

/**
 * The providers a founder said they charge through — the integration wizard's
 * multi-select. Drives the setup progress; never gates anything. Its own table
 * so affiliates, who can read a program's workspace row, never see billing setup.
 */
export const billingSetupSelections = pgTable("billing_setup_selections", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  providers: text("providers").array().notNull().default(sql`'{}'::text[]`),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const customersRelations = relations(customers, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [customers.workspaceId],
    references: [workspaces.id],
  }),
  subscriptions: many(subscriptions),
  transactions: many(transactions),
}))

export const subscriptionsRelations = relations(subscriptions, ({ one, many }) => ({
  customer: one(customers, {
    fields: [subscriptions.customerId],
    references: [customers.id],
  }),
  transactions: many(transactions),
}))

export const transactionsRelations = relations(transactions, ({ one }) => ({
  customer: one(customers, {
    fields: [transactions.customerId],
    references: [customers.id],
  }),
  subscription: one(subscriptions, {
    fields: [transactions.subscriptionId],
    references: [subscriptions.id],
  }),
}))
