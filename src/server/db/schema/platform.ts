import { relations, sql } from "drizzle-orm"
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import {
  apiKeyTypeEnum,
  billingProviderEnum,
  integrationStatusEnum,
  webhookStatusEnum,
} from "./enums"
import { workspaces } from "./tenancy"

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),

    provider: billingProviderEnum("provider").notNull(),
    providerAccountId: text("provider_account_id"),
    status: integrationStatusEnum("status").notNull().default("disconnected"),

    /** AES-256-GCM. Only for providers that force us to hold a token. */
    encryptedCredentials: text("encrypted_credentials"),
    /** Non-sensitive provider metadata only. Never tokens. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),

    connectedAt: timestamp("connected_at", { withTimezone: true }),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("integrations_workspace_provider_key").on(t.workspaceId, t.provider),
    index("integrations_account_idx")
      .on(t.provider, t.providerAccountId)
      .where(sql`provider_account_id is not null`),
  ],
)

/** Only the hash is stored. The plaintext is shown exactly once, at creation. */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    type: apiKeyTypeEnum("type").notNull(),
    /** Displayable, e.g. `sk_live_a1b2c3`. */
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),

    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("api_keys_hash_key").on(t.keyHash),
    index("api_keys_workspace_idx").on(t.workspaceId, t.type),
  ],
)

/** The idempotency gate. UNIQUE (provider, provider_event_id) is mandatory. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    provider: billingProviderEnum("provider").notNull(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "set null",
    }),

    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    payloadHash: text("payload_hash").notNull(),

    status: webhookStatusEnum("status").notNull().default("received"),
    errorMessage: text("error_message"),

    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("webhook_events_provider_event_key").on(t.provider, t.providerEventId),
    index("webhook_events_status_idx").on(t.status, t.receivedAt.desc()),
  ],
)

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id"),

    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    action: text("action").notNull(),

    /** Never secrets, tokens or full payloads. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_workspace_time_idx").on(t.workspaceId, t.createdAt.desc()),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
  ],
)

export const integrationsRelations = relations(integrations, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [integrations.workspaceId],
    references: [workspaces.id],
  }),
}))

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [apiKeys.workspaceId],
    references: [workspaces.id],
  }),
}))
