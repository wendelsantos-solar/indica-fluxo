import { relations, sql } from "drizzle-orm"
import {
  char,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import {
  affiliateStatusEnum,
  attributionModelEnum,
  environmentEnum,
  commissionTypeEnum,
  programAffiliateStatusEnum,
  programStatusEnum,
} from "./enums"
import { workspaces } from "./tenancy"

export const programs = pgTable(
  "programs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    /**
     * The product's own site, where the founder installed the tracker. The
     * affiliate's default referral link points here; NULL until configured.
     */
    websiteUrl: text("website_url"),
    status: programStatusEnum("status").notNull().default("draft"),
    /**
     * Fixed at creation. A test program only ever sees test clicks, test keys
     * and Stripe test-mode events; a live one needs a plan with live mode.
     */
    environment: environmentEnum("environment").notNull().default("test"),

    commissionType: commissionTypeEnum("commission_type").notNull().default("percentage"),
    /** Basis points when percentage, minor units when fixed. */
    commissionValue: integer("commission_value").notNull(),
    /** NULL = lifetime. 1 = first payment only. */
    commissionDurationMonths: integer("commission_duration_months"),

    attributionModel: attributionModelEnum("attribution_model").notNull().default("last_click"),
    attributionWindowDays: integer("attribution_window_days").notNull().default(60),
    commissionHoldDays: integer("commission_hold_days").notNull().default(30),

    currency: char("currency", { length: 3 }).notNull().default("USD"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("programs_workspace_slug_key").on(t.workspaceId, t.slug),
    index("programs_workspace_status_idx").on(t.workspaceId, t.status),
    index("programs_workspace_environment_idx").on(t.workspaceId, t.environment),
    check("programs_commission_value_positive", sql`${t.commissionValue} > 0`),
    check(
      "programs_attribution_window_sane",
      sql`${t.attributionWindowDays} between 1 and 365`,
    ),
    check("programs_hold_days_sane", sql`${t.commissionHoldDays} between 0 and 180`),
    check(
      "programs_duration_sane",
      sql`${t.commissionDurationMonths} is null or ${t.commissionDurationMonths} between 1 and 120`,
    ),
  ],
)

/**
 * Scoped to a workspace on purpose: tenant isolation stays a single-column
 * predicate and no workspace can probe another's affiliate list. See
 * ARCHITECTURE.md §2.
 */
export const affiliates = pgTable(
  "affiliates",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Null until the affiliate signs in and the row is claimed by e-mail. */
    userId: uuid("user_id"),
    email: text("email").notNull(),
    name: text("name").notNull(),
    companyName: text("company_name"),
    country: char("country", { length: 2 }),
    status: affiliateStatusEnum("status").notNull().default("invited"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("affiliates_workspace_email_key").on(t.workspaceId, sql`lower(${t.email})`),
    index("affiliates_workspace_status_idx").on(t.workspaceId, t.status),
    index("affiliates_user_idx").on(t.userId).where(sql`user_id is not null`),
  ],
)

export const programAffiliates = pgTable(
  "program_affiliates",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    affiliateId: uuid("affiliate_id")
      .notNull()
      .references(() => affiliates.id, { onDelete: "cascade" }),

    /** The public referral identifier: `?ref=wendel`. */
    code: text("code").notNull(),
    status: programAffiliateStatusEnum("status").notNull().default("pending"),

    customCommissionType: commissionTypeEnum("custom_commission_type"),
    customCommissionValue: integer("custom_commission_value"),

    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("program_affiliates_program_code_key").on(t.programId, t.code),
    uniqueIndex("program_affiliates_program_affiliate_key").on(t.programId, t.affiliateId),
    index("program_affiliates_affiliate_idx").on(t.affiliateId),
    index("program_affiliates_program_status_idx").on(t.programId, t.status),
    check("program_affiliates_code_format", sql`${t.code} ~ '^[a-z0-9][a-z0-9_-]{1,48}$'`),
    check(
      "program_affiliates_custom_rate_pairing",
      sql`(${t.customCommissionType} is null) = (${t.customCommissionValue} is null)`,
    ),
  ],
)

export const referralLinks = pgTable(
  "referral_links",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    programAffiliateId: uuid("program_affiliate_id")
      .notNull()
      .references(() => programAffiliates.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    destinationUrl: text("destination_url").notNull(),
    code: text("code").notNull(),
    campaign: text("campaign"),

    /** Display convenience only — referral_clicks is the source of truth. */
    clickCountCached: integer("click_count_cached").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("referral_links_participation_code_key").on(t.programAffiliateId, t.code)],
)

export const programsRelations = relations(programs, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [programs.workspaceId],
    references: [workspaces.id],
  }),
  participations: many(programAffiliates),
}))

export const affiliatesRelations = relations(affiliates, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [affiliates.workspaceId],
    references: [workspaces.id],
  }),
  participations: many(programAffiliates),
}))

export const programAffiliatesRelations = relations(programAffiliates, ({ one, many }) => ({
  program: one(programs, {
    fields: [programAffiliates.programId],
    references: [programs.id],
  }),
  affiliate: one(affiliates, {
    fields: [programAffiliates.affiliateId],
    references: [affiliates.id],
  }),
  links: many(referralLinks),
}))

export const referralLinksRelations = relations(referralLinks, ({ one }) => ({
  participation: one(programAffiliates, {
    fields: [referralLinks.programAffiliateId],
    references: [programAffiliates.id],
  }),
}))
