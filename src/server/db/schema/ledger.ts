import { relations, sql } from "drizzle-orm"
import {
  bigint,
  char,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { customers, transactions } from "./billing"
import { commissionStatusEnum, environmentEnum, payoutBatchStatusEnum, payoutItemStatusEnum } from "./enums"
import { programAffiliates, programs } from "./programs"
import { workspaces } from "./tenancy"

/**
 * The ledger. Append-mostly: a commission is never deleted and never edited
 * downward. A refund inserts a negative reversal row referencing the original
 * and flips the original's status to `reversed`. See DATABASE.md §3.
 */
export const commissions = pgTable(
  "commissions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "restrict" }),
    programAffiliateId: uuid("program_affiliate_id")
      .notNull()
      .references(() => programAffiliates.id, { onDelete: "restrict" }),

    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "restrict" }),

    currency: char("currency", { length: 3 }).notNull(),
    baseAmountMinor: bigint("base_amount_minor", { mode: "number" }).notNull(),
    /** Basis points; null for fixed-amount rules. */
    commissionRate: integer("commission_rate"),
    /** Signed: negative on a reversal row. */
    commissionAmountMinor: bigint("commission_amount_minor", { mode: "number" }).notNull(),

    status: commissionStatusEnum("status").notNull().default("pending"),
    /** created_at + program.commission_hold_days. */
    eligibleAt: timestamp("eligible_at", { withTimezone: true }).notNull(),

    /** Set on reversal rows; points at the commission being undone. */
    reversalOfCommissionId: uuid("reversal_of_commission_id"),
    /** Human-readable trace of which rule produced this row. */
    ruleApplied: text("rule_applied"),

    approvedAt: timestamp("approved_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One commission per transaction per affiliate, whatever the webhook does.
    uniqueIndex("commissions_transaction_participation_key")
      .on(t.transactionId, t.programAffiliateId)
      .where(sql`reversal_of_commission_id is null`),
    index("commissions_workspace_status_idx").on(t.workspaceId, t.status, t.eligibleAt),
    index("commissions_participation_status_idx").on(t.programAffiliateId, t.status),
    index("commissions_transaction_idx").on(t.transactionId),
    index("commissions_program_idx").on(t.programId, t.createdAt.desc()),
    // The commissions list's default order (newest first) without sorting the
    // whole workspace ledger (PERFORMANCE_AUDIT.md DB-3).
    index("commissions_workspace_created_idx").on(t.workspaceId, t.createdAt.desc(), t.id),
    // Refund/dispute ingest sums a commission's earlier reversals with no
    // workspace filter; without this it scans every tenant's ledger.
    index("commissions_reversal_of_idx")
      .on(t.reversalOfCommissionId)
      .where(sql`reversal_of_commission_id is not null`),
  ],
)

export const payoutBatches = pgTable(
  "payout_batches",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),

    reference: text("reference").notNull(),
    /** A test batch pays test commissions only — nothing real is owed. */
    environment: environmentEnum("environment").notNull().default("test"),
    currency: char("currency", { length: 3 }).notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),

    status: payoutBatchStatusEnum("status").notNull().default("draft"),
    totalAmountMinor: bigint("total_amount_minor", { mode: "number" }).notNull().default(0),

    notes: text("notes"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (t) => [
    index("payout_batches_workspace_idx").on(t.workspaceId, t.createdAt.desc()),
    uniqueIndex("payout_batches_workspace_reference_key").on(t.workspaceId, t.environment, t.reference),
  ],
)

export const payoutItems = pgTable(
  "payout_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    payoutBatchId: uuid("payout_batch_id")
      .notNull()
      .references(() => payoutBatches.id, { onDelete: "cascade" }),
    programAffiliateId: uuid("program_affiliate_id")
      .notNull()
      .references(() => programAffiliates.id, { onDelete: "restrict" }),

    /** Snapshot at batch time, so later ledger activity cannot rewrite history. */
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),

    status: payoutItemStatusEnum("status").notNull().default("pending"),
    externalReference: text("external_reference"),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (t) => [
    index("payout_items_batch_idx").on(t.payoutBatchId),
    index("payout_items_participation_idx").on(t.programAffiliateId),
    uniqueIndex("payout_items_batch_participation_key").on(
      t.payoutBatchId,
      t.programAffiliateId,
    ),
  ],
)

/** Which commissions a payout item covers. Keeps the ledger auditable. */
export const payoutItemCommissions = pgTable(
  "payout_item_commissions",
  {
    payoutItemId: uuid("payout_item_id")
      .notNull()
      .references(() => payoutItems.id, { onDelete: "cascade" }),
    commissionId: uuid("commission_id")
      .notNull()
      .references(() => commissions.id, { onDelete: "restrict" }),
  },
  (t) => [
    uniqueIndex("payout_item_commissions_key").on(t.payoutItemId, t.commissionId),
    index("payout_item_commissions_commission_idx").on(t.commissionId),
  ],
)

export const commissionsRelations = relations(commissions, ({ one }) => ({
  program: one(programs, {
    fields: [commissions.programId],
    references: [programs.id],
  }),
  participation: one(programAffiliates, {
    fields: [commissions.programAffiliateId],
    references: [programAffiliates.id],
  }),
  transaction: one(transactions, {
    fields: [commissions.transactionId],
    references: [transactions.id],
  }),
  customer: one(customers, {
    fields: [commissions.customerId],
    references: [customers.id],
  }),
}))

export const payoutBatchesRelations = relations(payoutBatches, ({ many }) => ({
  items: many(payoutItems),
}))

export const payoutItemsRelations = relations(payoutItems, ({ one, many }) => ({
  batch: one(payoutBatches, {
    fields: [payoutItems.payoutBatchId],
    references: [payoutBatches.id],
  }),
  participation: one(programAffiliates, {
    fields: [payoutItems.programAffiliateId],
    references: [programAffiliates.id],
  }),
  commissions: many(payoutItemCommissions),
}))
