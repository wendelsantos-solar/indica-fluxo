-- ---------------------------------------------------------------------------
-- Universal attribution + N billing connectors
-- (UNIVERSAL_ATTRIBUTION_ARCHITECTURE.md, MULTI_PROVIDER_INTEGRATION_AUDIT.md).
--
-- Additive. No row of the ledger is rewritten, no column is dropped. The one
-- non-additive statement is the swap of `integrations_workspace_provider_key`
-- (one connection per provider per workspace) for a unique key per provider
-- ACCOUNT, which is what "Stripe Brasil + Stripe EUA" needs. Every existing
-- workspace holds at most one row per provider, so the new index always builds.
--
-- New enum values are ADDED but never USED in this file: the migrator applies
-- pending migrations in one transaction, and a value added by ALTER TYPE cannot
-- be referenced before that transaction commits.
--
-- Rollback (manual, in order):
--   DROP FUNCTION public.billing_connection_recent_events(uuid, uuid, integer);
--   DROP FUNCTION public.billing_connection_events(uuid, timestamptz);
--   DROP TABLE billing_setup_selections;
--   DROP TABLE billing_identities;
--   ALTER TABLE transactions DROP COLUMN integration_id;
--   ALTER TABLE webhook_events DROP COLUMN integration_id, DROP COLUMN reason_code;
--   DROP INDEX integrations_workspace_account_key;
--   CREATE UNIQUE INDEX integrations_workspace_provider_key ON integrations (workspace_id, provider);
--     (valid only while each workspace still has one row per provider)
--   ALTER TABLE integrations DROP COLUMN display_name, environment, last_verified_at, status_reason;
--   Enum values cannot be dropped; unused values are harmless.
-- ---------------------------------------------------------------------------

ALTER TYPE "public"."billing_provider" ADD VALUE IF NOT EXISTS 'mercado_pago';
--> statement-breakpoint
ALTER TYPE "public"."billing_provider" ADD VALUE IF NOT EXISTS 'abacatepay';
--> statement-breakpoint
ALTER TYPE "public"."billing_provider" ADD VALUE IF NOT EXISTS 'asaas';
--> statement-breakpoint
-- A connection being set up: the provider has not confirmed anything yet.
ALTER TYPE "public"."integration_status" ADD VALUE IF NOT EXISTS 'pending';
--> statement-breakpoint

-- 1. `integrations` is the billing-connection table. -------------------------
ALTER TABLE "integrations" ADD COLUMN "display_name" text;
--> statement-breakpoint
-- NULL = the connection spans both modes (a Stripe connection holds a test
-- and a live endpoint secret). API-key connectors are one environment each.
ALTER TABLE "integrations" ADD COLUMN "environment" "environment";
--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "last_verified_at" timestamp with time zone;
--> statement-breakpoint
-- A closed, sanitized code (`auth_failed`, `webhook_registration_failed`, …).
-- Never a provider message, never a secret.
ALTER TABLE "integrations" ADD COLUMN "status_reason" text;
--> statement-breakpoint
DROP INDEX IF EXISTS "integrations_workspace_provider_key";
--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_workspace_account_key"
  ON "integrations" USING btree ("workspace_id", "provider", "provider_account_id")
  WHERE provider_account_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "integrations_workspace_idx" ON "integrations" USING btree ("workspace_id", "created_at");
--> statement-breakpoint

-- 2. Which connection an event came through, and why it earned nothing. ------
ALTER TABLE "webhook_events" ADD COLUMN "integration_id" uuid;
--> statement-breakpoint
ALTER TABLE "webhook_events"
  ADD CONSTRAINT "webhook_events_integration_id_integrations_id_fk"
  FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Closed list: src/lib/billing/reasons.ts. `error_message` keeps its free text.
ALTER TABLE "webhook_events" ADD COLUMN "reason_code" text;
--> statement-breakpoint
CREATE INDEX "webhook_events_integration_time_idx"
  ON "webhook_events" USING btree ("integration_id", "received_at" DESC NULLS LAST)
  WHERE integration_id IS NOT NULL;
--> statement-breakpoint

-- 3. Which connection recorded a payment (provenance, per-account health). ----
-- Nullable and written once, at insert: rows recorded before this migration,
-- simulations and the legacy platform endpoint leave it NULL.
ALTER TABLE "transactions" ADD COLUMN "integration_id" uuid;
--> statement-breakpoint
ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_integration_id_integrations_id_fk"
  FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

-- 4. One customer, N provider identities. -------------------------------------
CREATE TABLE "billing_identities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "customer_id" uuid NOT NULL,
  "environment" "environment" NOT NULL,
  "provider" "billing_provider" NOT NULL,
  "provider_customer_id" text NOT NULL,
  "integration_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_identities"
  ADD CONSTRAINT "billing_identities_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "billing_identities"
  ADD CONSTRAINT "billing_identities_customer_id_customers_id_fk"
  FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "billing_identities"
  ADD CONSTRAINT "billing_identities_integration_id_integrations_id_fk"
  FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- The provider is part of the key: Stripe "123" and Mercado Pago "123" are two
-- identities. The account is not (UNIVERSAL_ATTRIBUTION_ARCHITECTURE.md §2).
CREATE UNIQUE INDEX "billing_identities_provider_customer_key"
  ON "billing_identities" USING btree ("workspace_id", "environment", "provider", "provider_customer_id");
--> statement-breakpoint
CREATE INDEX "billing_identities_customer_idx" ON "billing_identities" USING btree ("customer_id");
--> statement-breakpoint

-- Backfill 1:1 from the one identity a customer row could hold. The source
-- already has this exact unique key, so nothing can conflict.
INSERT INTO "billing_identities" ("workspace_id", "customer_id", "environment", "provider", "provider_customer_id", "created_at", "last_seen_at")
SELECT c.workspace_id, c.id, c.environment, c.provider, c.provider_customer_id, c.created_at, c.updated_at
  FROM "customers" c
 WHERE c.provider_customer_id IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint

ALTER TABLE "billing_identities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Members read; nothing else. Written only on the service connection by the
-- webhook ingest path and by POST /api/identify (both provider- or
-- key-authenticated, never a browser session) — like `attribution_tokens`.
CREATE POLICY "billing_identities_member_select" ON public.billing_identities
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.member_workspace_ids()));
--> statement-breakpoint
GRANT SELECT ON public.billing_identities TO indica_app;
--> statement-breakpoint
REVOKE ALL ON public.billing_identities FROM anon, authenticated;
--> statement-breakpoint

-- 5. The providers a founder said they charge through (the wizard's selection).
-- Its own table rather than a `workspaces` column: affiliates can read their
-- programs' workspace row (workspaces_affiliate_select), and billing setup is
-- not theirs to see. Members read, owners/admins write — the standard pair.
CREATE TABLE "billing_setup_selections" (
  "workspace_id" uuid PRIMARY KEY NOT NULL,
  "providers" text[] DEFAULT '{}'::text[] NOT NULL,
  "updated_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_setup_selections"
  ADD CONSTRAINT "billing_setup_selections_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "billing_setup_selections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "billing_setup_selections_member_select" ON public.billing_setup_selections
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.member_workspace_ids()));
--> statement-breakpoint
CREATE POLICY "billing_setup_selections_admin_write" ON public.billing_setup_selections
  FOR ALL TO authenticated
  USING (workspace_id IN (SELECT public.admin_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT public.admin_workspace_ids()));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.billing_setup_selections TO indica_app;
--> statement-breakpoint
REVOKE ALL ON public.billing_setup_selections FROM anon, authenticated;
--> statement-breakpoint

-- 6. Per-connection evidence for members. `webhook_events` stays closed (DATABASE.md §6):
-- these return times, types, statuses, reason codes and counts — never the raw
-- error text, never a payload. An event recorded before `integration_id`
-- existed is attributed to the workspace's oldest connection of its provider.
CREATE OR REPLACE FUNCTION public.billing_connection_events(p_workspace_id uuid, p_since timestamptz)
RETURNS TABLE (
  integration_id uuid,
  last_event_at timestamptz,
  last_event_type text,
  last_status public.webhook_status,
  last_reason_code text,
  events bigint,
  failed bigint,
  unsupported bigint,
  without_customer bigint,
  mismatched bigint,
  last_failed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH scoped AS (
    SELECT coalesce(
             e.integration_id,
             (SELECT i.id FROM public.integrations i
               WHERE i.workspace_id = e.workspace_id AND i.provider = e.provider
               ORDER BY i.created_at LIMIT 1)
           ) AS integration_id,
           e.received_at, e.event_type, e.status, e.reason_code, e.error_message
      FROM public.webhook_events e
     WHERE e.workspace_id = p_workspace_id
       AND e.scope = 'customer_billing'
       AND e.received_at >= p_since
       AND public.is_workspace_member(p_workspace_id)
  )
  SELECT s.integration_id,
         max(s.received_at),
         (array_agg(s.event_type ORDER BY s.received_at DESC))[1],
         (array_agg(s.status ORDER BY s.received_at DESC))[1],
         (array_agg(s.reason_code ORDER BY s.received_at DESC))[1],
         count(*),
         count(*) FILTER (WHERE s.status = 'failed'),
         count(*) FILTER (WHERE s.reason_code = 'UNSUPPORTED_EVENT'),
         count(*) FILTER (WHERE s.reason_code = 'CUSTOMER_NOT_LINKED' OR s.error_message = 'payment has no customer'),
         count(*) FILTER (WHERE s.reason_code = 'TEST_LIVE_MISMATCH'),
         max(s.received_at) FILTER (WHERE s.status = 'failed')
    FROM scoped s
   WHERE s.integration_id IS NOT NULL
   GROUP BY s.integration_id;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.billing_connection_events(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.billing_connection_events(uuid, timestamptz) TO indica_app;
--> statement-breakpoint

-- The latest events of one connection, for its diagnostics timeline.
CREATE OR REPLACE FUNCTION public.billing_connection_recent_events(p_workspace_id uuid, p_integration_id uuid, p_limit integer)
RETURNS TABLE (
  received_at timestamptz,
  event_type text,
  status public.webhook_status,
  reason_code text,
  environment public.environment,
  provider_event_id text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT e.received_at, e.event_type, e.status, e.reason_code, e.environment, e.provider_event_id
    FROM public.webhook_events e
   WHERE e.workspace_id = p_workspace_id
     AND e.scope = 'customer_billing'
     AND public.is_workspace_member(p_workspace_id)
     AND (
       e.integration_id = p_integration_id
       OR (e.integration_id IS NULL AND e.provider = (
             SELECT i.provider FROM public.integrations i
              WHERE i.id = p_integration_id AND i.workspace_id = p_workspace_id
                AND i.id = (SELECT i2.id FROM public.integrations i2
                             WHERE i2.workspace_id = p_workspace_id AND i2.provider = i.provider
                             ORDER BY i2.created_at LIMIT 1)))
     )
   ORDER BY e.received_at DESC
   LIMIT least(greatest(p_limit, 1), 50);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.billing_connection_recent_events(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.billing_connection_recent_events(uuid, uuid, integer) TO indica_app;
