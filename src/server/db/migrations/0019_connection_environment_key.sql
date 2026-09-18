-- 0019_connection_environment_key
--
-- A billing connection is unique per (workspace, provider, provider account,
-- environment) — not per (workspace, provider, provider account).
--
-- Why: one merchant account can hold a test and a live credential. Mercado
-- Pago's `TEST-…` and `APP_USR-…` tokens belong to the same seller (`user_id`),
-- so a workspace that connects both would, under the 0018 key, fail to record
-- the account on the second connection. Both are valid configurations; events
-- never mix because every non-Stripe delivery is routed by the connection id in
-- its URL and refused (`TEST_LIVE_MISMATCH`) when its environment differs from
-- the connection's.
--
-- Stripe keeps one row per account: its connection spans both modes
-- (`environment IS NULL`, a test and a live endpoint secret), and Connect routes
-- by `event.account` — two rows for one `acct_…` would be ambiguous.
--
-- Rollback (valid while no account has both a test and a live row):
--   DROP INDEX integrations_workspace_account_env_key;
--   DROP INDEX integrations_workspace_account_key;
--   CREATE UNIQUE INDEX integrations_workspace_account_key
--     ON integrations (workspace_id, provider, provider_account_id)
--     WHERE provider_account_id IS NOT NULL;

DROP INDEX IF EXISTS "integrations_workspace_account_key";
--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_workspace_account_key"
  ON "integrations" USING btree ("workspace_id", "provider", "provider_account_id")
  WHERE provider_account_id IS NOT NULL AND environment IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_workspace_account_env_key"
  ON "integrations" USING btree ("workspace_id", "provider", "provider_account_id", "environment")
  WHERE provider_account_id IS NOT NULL AND environment IS NOT NULL;
