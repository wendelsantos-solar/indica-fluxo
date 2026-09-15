-- ---------------------------------------------------------------------------
-- The application gets its own database role; the Supabase Data API loses write
-- (and read) access to the product tables.
--
-- Until now `withUser()` impersonated `authenticated`, the same role PostgREST
-- uses for a signed-in browser. Every rule that lives in the services — plan
-- limits, "an admin cannot touch an owner", the append-only ledger, payout
-- history — was therefore one `supabase.from(...).insert()` away from being
-- skipped by anyone holding their own session and the publishable key, because
-- the RLS policies can only express tenancy, not those rules (PLAN_FEATURE_AUDIT
-- A1/A2). Nothing in the app reads or writes data through the Data API.
--
-- `indica_app` is a member of `authenticated`, so:
-- - every existing policy written `TO authenticated` applies to it unchanged,
--   and `auth.uid()` keeps reading the claims `withUser()` sets;
-- - PostgREST's `authenticator` is not a member of `indica_app`, so no API
--   request can assume it.
-- Table privileges move from `authenticated` to `indica_app`, exactly as they
-- were (including column grants), then `authenticated` and `anon` lose them.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'indica_app') THEN
    CREATE ROLE indica_app NOLOGIN INHERIT;
  END IF;
END $$;
--> statement-breakpoint
GRANT authenticated TO indica_app;
--> statement-breakpoint
-- The migrating/service user must be able to `SET ROLE indica_app`.
GRANT indica_app TO current_user;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO indica_app;
--> statement-breakpoint

DO $$
DECLARE g record;
BEGIN
  -- Table-level privileges, as `authenticated` holds them today.
  FOR g IN
    SELECT table_name, privilege_type
      FROM information_schema.role_table_grants
     WHERE grantee = 'authenticated' AND table_schema = 'public'
  LOOP
    EXECUTE format('GRANT %s ON public.%I TO indica_app', g.privilege_type, g.table_name);
  END LOOP;

  -- Column-level privileges that are not implied by a table-level one
  -- (e.g. UPDATE on selected `workspaces` columns, migration 0006).
  FOR g IN
    SELECT c.table_name, c.column_name, c.privilege_type
      FROM information_schema.column_privileges c
     WHERE c.grantee = 'authenticated' AND c.table_schema = 'public'
       AND NOT EXISTS (
         SELECT 1 FROM information_schema.role_table_grants t
          WHERE t.grantee = 'authenticated' AND t.table_schema = 'public'
            AND t.table_name = c.table_name AND t.privilege_type = c.privilege_type
       )
  LOOP
    EXECUTE format('GRANT %s (%I) ON public.%I TO indica_app', g.privilege_type, g.column_name, g.table_name);
  END LOOP;

  -- Functions callable by the app (claim_pending_invites, latest_webhook_event,
  -- the RLS helpers). Policies evaluate helpers with the querying role's rights.
  FOR g IN
    SELECT p.oid::regprocedure AS fn
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO indica_app', g.fn);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', g.fn);
  END LOOP;
END $$;
--> statement-breakpoint

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated, anon;
--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated, anon;
--> statement-breakpoint

-- Supabase's default privileges grant every new table in `public` to `anon`
-- and `authenticated`. Without this, the next migration would reopen the API.
-- New tables are granted to `indica_app` explicitly, migration by migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- History the app must never rewrite, now enforced for the app role too.
REVOKE UPDATE, DELETE ON public.audit_logs FROM indica_app;
--> statement-breakpoint
REVOKE DELETE ON public.payout_batches FROM indica_app;
--> statement-breakpoint
REVOKE DELETE ON public.payout_items FROM indica_app;
