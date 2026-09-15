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

import { workspacePlanEnum, workspaceRoleEnum } from "./enums"

/** `id` references `auth.users(id)`; the FK is added in migration 0001. */
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  fullName: text("full_name"),
  avatarUrl: text("avatar_url"),
  timezone: text("timezone").notNull().default("UTC"),
  locale: text("locale").notNull().default("en"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    logoUrl: text("logo_url"),
    defaultCurrency: char("default_currency", { length: 3 }).notNull().default("USD"),
    timezone: text("timezone").notNull().default("UTC"),
    /**
     * Not writable by `authenticated`: migration 0006 narrows the UPDATE grant
     * on this table to the editable columns, so a workspace admin cannot
     * upgrade themselves through the Supabase API. Changed by the operator.
     */
    plan: workspacePlanEnum("plan").notNull().default("starter"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("workspaces_slug_key").on(t.slug)],
)

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    role: workspaceRoleEnum("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("workspace_members_workspace_user_key").on(t.workspaceId, t.userId),
    index("workspace_members_user_idx").on(t.userId),
  ],
)

/** Claimed by e-mail match on first sign-in; no token to leak or expire badly. */
export const workspaceInvites = pgTable(
  "workspace_invites",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: workspaceRoleEnum("role").notNull().default("member"),
    invitedBy: uuid("invited_by"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // `lower(email)`, to match `handle_new_user()`, which claims invites
    // case-insensitively. Without it, Bob@acme.com and bob@acme.com are two
    // accepted pending invites for one person. See migration 0002.
    uniqueIndex("workspace_invites_pending_key")
      .on(t.workspaceId, sql`lower(${t.email})`)
      .where(sql`accepted_at is null`),
  ],
)

/**
 * A founder asking to move to another plan. There is no self-serve checkout:
 * the operator reviews the request and changes `workspaces.plan`, then stamps
 * `handled_at`. Members read; owners/admins insert (migration 0006).
 */
export const planUpgradeRequests = pgTable(
  "plan_upgrade_requests",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    requestedPlan: workspacePlanEnum("requested_plan").notNull(),
    requestedBy: uuid("requested_by").notNull(),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("plan_upgrade_requests_workspace_idx").on(t.workspaceId, t.createdAt.desc()),
    uniqueIndex("plan_upgrade_requests_open_key")
      .on(t.workspaceId, t.requestedPlan)
      .where(sql`handled_at is null`),
  ],
)

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  members: many(workspaceMembers),
  invites: many(workspaceInvites),
}))

export const workspaceMembersRelations = relations(workspaceMembers, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceMembers.workspaceId],
    references: [workspaces.id],
  }),
  profile: one(profiles, {
    fields: [workspaceMembers.userId],
    references: [profiles.id],
  }),
}))
