-- ---------------------------------------------------------------------------
-- RLS: the same authorisation, evaluated once per statement instead of once
-- per row. (PERFORMANCE_AUDIT.md, finding DB-1.)
--
-- The helpers from 0001 take a row value — `is_workspace_member(workspace_id)`,
-- `owns_participation(program_affiliate_id)`. They are SECURITY DEFINER, so
-- Postgres cannot inline them, and a policy calling one runs a membership
-- lookup for EVERY row a query scans. Measured at 300k clicks / 31k
-- commissions: counting 30 days of clicks took 2 352 ms under RLS against
-- 96 ms without it.
--
-- Each helper below returns the SET the old predicate accepts, for the current
-- `auth.uid()`. `x IN (SELECT set_fn())` is uncorrelated, so the set is
-- computed once per statement and each row costs a hash probe. Row for row:
--
--   is_workspace_member(ws)                               ⇔ ws  IN member_workspace_ids()
--   has_workspace_role(ws, '{owner,admin}')               ⇔ ws  IN admin_workspace_ids()
--   is_workspace_member(program_workspace(p))             ⇔ p   IN member_program_ids()
--   has_workspace_role(program_workspace(p), '{owner,admin}') ⇔ p IN admin_program_ids()
--   owns_participation(pa)                                ⇔ pa  IN current_participation_ids()
--
-- (A NULL or unknown id is denied on both sides.) Verified on every row of
-- every rewritten table, for every user of the dev database, by
-- `RLS_MIGRATION=0013_rls_set_membership pnpm perf:explain`.
--
-- Only the policies on hot or high-volume tables change; the 0001 helpers stay,
-- because other policies and functions still call them. Policies remain
-- `TO authenticated` (indica_app is a member, migration 0009).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.member_workspace_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
ROWS 10
AS $$
  SELECT m.workspace_id FROM public.workspace_members m WHERE m.user_id = auth.uid();
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.admin_workspace_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
ROWS 10
AS $$
  SELECT m.workspace_id FROM public.workspace_members m
   WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'admin');
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.member_program_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
ROWS 20
AS $$
  SELECT p.id FROM public.programs p
    JOIN public.workspace_members m ON m.workspace_id = p.workspace_id
   WHERE m.user_id = auth.uid();
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.admin_program_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
ROWS 20
AS $$
  SELECT p.id FROM public.programs p
    JOIN public.workspace_members m ON m.workspace_id = p.workspace_id
   WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'admin');
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.current_participation_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
ROWS 10
AS $$
  SELECT pa.id FROM public.program_affiliates pa
    JOIN public.affiliates a ON a.id = pa.affiliate_id
   WHERE a.user_id = auth.uid();
$$;
--> statement-breakpoint

-- New functions are executable by PUBLIC by default; only the app role may call them.
REVOKE ALL ON FUNCTION public.member_workspace_ids() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.admin_workspace_ids() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.member_program_ids() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.admin_program_ids() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.current_participation_ids() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.member_workspace_ids() TO indica_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.admin_workspace_ids() TO indica_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.member_program_ids() TO indica_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.admin_program_ids() TO indica_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.current_participation_ids() TO indica_app;
--> statement-breakpoint

-- Workspace-scoped tables (0001 §6): read for members, write for owner/admin.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'programs','affiliates','customers','subscriptions','transactions',
    'integrations','api_keys','payout_batches','audit_logs','commissions'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_member_select', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR SELECT TO authenticated
        USING (workspace_id IN (SELECT public.member_workspace_ids()));
    $f$, t || '_member_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_write', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR ALL TO authenticated
        USING (workspace_id IN (SELECT public.admin_workspace_ids()))
        WITH CHECK (workspace_id IN (SELECT public.admin_workspace_ids()));
    $f$, t || '_admin_write', t);
  END LOOP;
END $$;
--> statement-breakpoint

DROP POLICY IF EXISTS "program_affiliates_member_select" ON public.program_affiliates;
--> statement-breakpoint
CREATE POLICY "program_affiliates_member_select" ON public.program_affiliates
  FOR SELECT TO authenticated
  USING (
    program_id IN (SELECT public.member_program_ids())
    OR affiliate_id IN (SELECT public.current_affiliate_ids())
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "program_affiliates_admin_write" ON public.program_affiliates;
--> statement-breakpoint
CREATE POLICY "program_affiliates_admin_write" ON public.program_affiliates
  FOR ALL TO authenticated
  USING (program_id IN (SELECT public.admin_program_ids()))
  WITH CHECK (program_id IN (SELECT public.admin_program_ids()));
--> statement-breakpoint

DROP POLICY IF EXISTS "referral_clicks_select" ON public.referral_clicks;
--> statement-breakpoint
CREATE POLICY "referral_clicks_select" ON public.referral_clicks
  FOR SELECT TO authenticated
  USING (
    program_id IN (SELECT public.member_program_ids())
    OR program_affiliate_id IN (SELECT public.current_participation_ids())
  );
--> statement-breakpoint

DROP POLICY IF EXISTS "attributions_select" ON public.attributions;
--> statement-breakpoint
CREATE POLICY "attributions_select" ON public.attributions
  FOR SELECT TO authenticated
  USING (
    program_id IN (SELECT public.member_program_ids())
    OR program_affiliate_id IN (SELECT public.current_participation_ids())
  );
--> statement-breakpoint

DROP POLICY IF EXISTS "commissions_affiliate_select" ON public.commissions;
--> statement-breakpoint
CREATE POLICY "commissions_affiliate_select" ON public.commissions
  FOR SELECT TO authenticated
  USING (program_affiliate_id IN (SELECT public.current_participation_ids()));
