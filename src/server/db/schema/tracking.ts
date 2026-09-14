import { relations, sql } from "drizzle-orm"
import {
  char,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { attributionModelEnum, deviceTypeEnum } from "./enums"
import { programAffiliates, programs, referralLinks } from "./programs"

/**
 * Highest-volume table in the system. Append-only, no PII: only a salted IP
 * hash and a coarse device type. See DATABASE.md §7.
 */
export const referralClicks = pgTable(
  "referral_clicks",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    programAffiliateId: uuid("program_affiliate_id")
      .notNull()
      .references(() => programAffiliates.id, { onDelete: "cascade" }),
    referralLinkId: uuid("referral_link_id").references(() => referralLinks.id, {
      onDelete: "set null",
    }),

    visitorId: text("visitor_id").notNull(),

    landingUrl: text("landing_url").notNull(),
    referrerUrl: text("referrer_url"),

    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmContent: text("utm_content"),
    utmTerm: text("utm_term"),

    country: char("country", { length: 2 }),
    deviceType: deviceTypeEnum("device_type").notNull().default("unknown"),
    /** sha256(ip + pepper). Never the address itself. 90-day retention. */
    ipHash: text("ip_hash"),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("referral_clicks_program_time_idx").on(t.programId, t.occurredAt.desc()),
    index("referral_clicks_participation_time_idx").on(
      t.programAffiliateId,
      t.occurredAt.desc(),
    ),
    index("referral_clicks_visitor_idx").on(t.visitorId, t.occurredAt.desc()),
    index("referral_clicks_link_idx").on(t.referralLinkId).where(sql`referral_link_id is not null`),
  ],
)

/**
 * One live attribution per (program, visitor). Updated in place according to
 * the program's model. This is the join between anonymous traffic and money.
 */
export const attributions = pgTable(
  "attributions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    programAffiliateId: uuid("program_affiliate_id")
      .notNull()
      .references(() => programAffiliates.id, { onDelete: "restrict" }),

    visitorId: text("visitor_id").notNull(),

    /** Written by POST /api/identify (secret-key authenticated only). */
    customerExternalId: text("customer_external_id"),
    providerCustomerId: text("provider_customer_id"),

    firstClickId: uuid("first_click_id").references(() => referralClicks.id, {
      onDelete: "set null",
    }),
    lastClickId: uuid("last_click_id").references(() => referralClicks.id, {
      onDelete: "set null",
    }),

    attributionModel: attributionModelEnum("attribution_model").notNull(),

    attributedAt: timestamp("attributed_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("attributions_program_visitor_key").on(t.programId, t.visitorId),
    index("attributions_provider_customer_idx")
      .on(t.providerCustomerId)
      .where(sql`provider_customer_id is not null`),
    index("attributions_external_customer_idx")
      .on(t.customerExternalId)
      .where(sql`customer_external_id is not null`),
    index("attributions_participation_idx").on(t.programAffiliateId),
  ],
)

export const referralClicksRelations = relations(referralClicks, ({ one }) => ({
  program: one(programs, {
    fields: [referralClicks.programId],
    references: [programs.id],
  }),
  participation: one(programAffiliates, {
    fields: [referralClicks.programAffiliateId],
    references: [programAffiliates.id],
  }),
}))

export const attributionsRelations = relations(attributions, ({ one }) => ({
  program: one(programs, {
    fields: [attributions.programId],
    references: [programs.id],
  }),
  participation: one(programAffiliates, {
    fields: [attributions.programAffiliateId],
    references: [programAffiliates.id],
  }),
}))
