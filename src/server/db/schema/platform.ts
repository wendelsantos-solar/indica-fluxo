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
  environmentEnum,
  integrationStatusEnum,
  webhookScopeEnum,
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
    /** The founder's own label ("Conta principal", "Loja BR"). Optional. */
    displayName: text("display_name"),
    /**
     * `null`: the connection spans both modes (Stripe keeps a test and a live
     * endpoint secret). API-key connectors are one environment each, from the key.
     */
    environment: environmentEnum("environment"),
    /** Last time the provider confirmed the credential (connect, re-verify). */
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    /** Closed, sanitized code for `error` / `pending` (see `ConnectionStatusReason`). */
    statusReason: text("status_reason"),

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
    // One row per provider ACCOUNT and ENVIRONMENT, not per provider: a
    // workspace may connect Stripe Brasil and Stripe EUA (migration 0018), and
    // one Mercado Pago seller's test and live tokens (migration 0019). A Stripe
    // row spans both modes (`environment` null), so it stays one per account.
    // Rows still waiting for the provider to tell us the account are not constrained.
    uniqueIndex("integrations_workspace_account_key")
      .on(t.workspaceId, t.provider, t.providerAccountId)
      .where(sql`provider_account_id is not null and environment is null`),
    uniqueIndex("integrations_workspace_account_env_key")
      .on(t.workspaceId, t.provider, t.providerAccountId, t.environment)
      .where(sql`provider_account_id is not null and environment is not null`),
    index("integrations_workspace_idx").on(t.workspaceId, t.createdAt),
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
    /** `pk_test_…` / `sk_test_…` reach test programs only; live keys, live programs only. */
    environment: environmentEnum("environment").notNull().default("test"),
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
    index("api_keys_workspace_idx").on(t.workspaceId, t.environment, t.type),
  ],
)

/**
 * The idempotency gate. UNIQUE (scope, provider, provider_event_id) is
 * mandatory: the same Stripe event id can legitimately reach both the
 * founder-billing endpoint and Refvia's own billing endpoint (a founder
 * whose Stripe account is Refvia's), and each must be processed once.
 */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    scope: webhookScopeEnum("scope").notNull().default("customer_billing"),
    provider: billingProviderEnum("provider").notNull(),
    /** From the provider's own flag (Stripe `livemode`); null when unknown. */
    environment: environmentEnum("environment"),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "set null",
    }),

    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    payloadHash: text("payload_hash").notNull(),

    status: webhookStatusEnum("status").notNull().default("received"),
    errorMessage: text("error_message"),
    /** Which connection delivered it (migration 0018). NULL for events recorded before. */
    integrationId: uuid("integration_id").references(() => integrations.id, { onDelete: "set null" }),
    /** Why it earned nothing, from the closed list in `src/lib/billing/reasons.ts`. */
    reasonCode: text("reason_code"),

    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("webhook_events_scope_provider_event_key").on(t.scope, t.provider, t.providerEventId),
    index("webhook_events_status_idx").on(t.status, t.receivedAt.desc()),
    // Latest event per workspace — Integrations' "last event received".
    index("webhook_events_workspace_time_idx").on(t.workspaceId, t.receivedAt.desc()),
    index("webhook_events_integration_time_idx")
      .on(t.integrationId, t.receivedAt.desc())
      .where(sql`integration_id is not null`),
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
