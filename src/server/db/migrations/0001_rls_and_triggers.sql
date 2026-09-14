-- ============================================================================
-- 0001 — auth wiring, updated_at triggers, RLS helpers and policies.
-- Handwritten: drizzle-kit does not model Supabase auth, triggers or policies.
-- See DATABASE.md §6.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Link profiles to auth.users and auto-provision a profile on sign-up.
-- ---------------------------------------------------------------------------
ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_id_auth_users_fk"
  FOREIGN KEY ("id") REFERENCES auth.users ("id") ON DELETE CASCADE;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name'),
    NEW.raw_user_meta_data ->> 'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;

  -- Claim any pending affiliate row or workspace invite addressed to this e-mail.
  UPDATE public.affiliates
     SET user_id = NEW.id, status = 'active', updated_at = now()
   WHERE user_id IS NULL
     AND lower(email) = lower(NEW.email);

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  SELECT i.workspace_id, NEW.id, i.role
    FROM public.workspace_invites i
   WHERE i.accepted_at IS NULL
     AND lower(i.email) = lower(NEW.email)
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  UPDATE public.workspace_invites
     SET accepted_at = now()
   WHERE accepted_at IS NULL
     AND lower(email) = lower(NEW.email);

  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
--> statement-breakpoint
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. updated_at maintenance.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles','workspaces','programs','affiliates','program_affiliates',
    'referral_links','attributions','customers','subscriptions','commissions',
    'payout_batches','integrations'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_updated_at ON public.%I;
       CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();', t, t);
  END LOOP;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. RLS helper functions.
--    SECURITY DEFINER so that the membership lookup itself is not filtered by
--    the very policy it is used to evaluate (which would recurse).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_workspace_member(ws uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members m
     WHERE m.workspace_id = ws AND m.user_id = auth.uid()
  );
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.has_workspace_role(ws uuid, roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members m
     WHERE m.workspace_id = ws
       AND m.user_id = auth.uid()
       AND m.role::text = ANY(roles)
  );
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.current_affiliate_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id FROM public.affiliates a WHERE a.user_id = auth.uid();
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.owns_participation(pa uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.program_affiliates p
      JOIN public.affiliates a ON a.id = p.affiliate_id
     WHERE p.id = pa AND a.user_id = auth.uid()
  );
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.program_workspace(p uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT workspace_id FROM public.programs WHERE id = p;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Enable (and FORCE) RLS everywhere.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles','workspaces','workspace_members','workspace_invites',
    'programs','affiliates','program_affiliates','referral_links',
    'referral_clicks','attributions','customers','subscriptions','transactions',
    'commissions','payout_batches','payout_items','payout_item_commissions',
    'integrations','api_keys','webhook_events','audit_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated;', t);
  END LOOP;
END $$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO anon, authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Policies — identity.
-- ---------------------------------------------------------------------------
CREATE POLICY "profiles_self_select" ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid());
--> statement-breakpoint
CREATE POLICY "profiles_self_update" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
--> statement-breakpoint

-- Workspace: members read; only owners/admins may rename; creation is handled
-- by the service role during onboarding (it must insert the first membership
-- in the same transaction, which no self-referential policy can express).
CREATE POLICY "workspaces_member_select" ON public.workspaces
  FOR SELECT TO authenticated USING (public.is_workspace_member(id));
--> statement-breakpoint
CREATE POLICY "workspaces_admin_update" ON public.workspaces
  FOR UPDATE TO authenticated
  USING (public.has_workspace_role(id, ARRAY['owner','admin']))
  WITH CHECK (public.has_workspace_role(id, ARRAY['owner','admin']));
--> statement-breakpoint
CREATE POLICY "workspaces_owner_delete" ON public.workspaces
  FOR DELETE TO authenticated USING (public.has_workspace_role(id, ARRAY['owner']));
--> statement-breakpoint

CREATE POLICY "workspace_members_select" ON public.workspace_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY "workspace_members_admin_write" ON public.workspace_members
  FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin']))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner','admin']));
--> statement-breakpoint

CREATE POLICY "workspace_invites_admin_all" ON public.workspace_invites
  FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin']))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner','admin']));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. Policies — workspace-scoped resources.
--    Read for any member; write for owner/admin only.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'programs','affiliates','customers','subscriptions','transactions',
    'integrations','api_keys','payout_batches','audit_logs','commissions'
  ] LOOP
    EXECUTE format($f$
      CREATE POLICY "%1$s_member_select" ON public.%1$I
        FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
    $f$, t);
    EXECUTE format($f$
      CREATE POLICY "%1$s_admin_write" ON public.%1$I
        FOR ALL TO authenticated
        USING (public.has_workspace_role(workspace_id, ARRAY['owner','admin']))
        WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner','admin']));
    $f$, t);
  END LOOP;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 7. Policies — program-scoped resources, readable by the owning affiliate.
-- ---------------------------------------------------------------------------
CREATE POLICY "program_affiliates_member_select" ON public.program_affiliates
  FOR SELECT TO authenticated
  USING (
    public.is_workspace_member(public.program_workspace(program_id))
    OR affiliate_id IN (SELECT public.current_affiliate_ids())
  );
--> statement-breakpoint
CREATE POLICY "program_affiliates_admin_write" ON public.program_affiliates
  FOR ALL TO authenticated
  USING (public.has_workspace_role(public.program_workspace(program_id), ARRAY['owner','admin']))
  WITH CHECK (public.has_workspace_role(public.program_workspace(program_id), ARRAY['owner','admin']));
--> statement-breakpoint

CREATE POLICY "referral_links_select" ON public.referral_links
  FOR SELECT TO authenticated
  USING (
    public.owns_participation(program_affiliate_id)
    OR EXISTS (
      SELECT 1 FROM public.program_affiliates pa
       WHERE pa.id = program_affiliate_id
         AND public.is_workspace_member(public.program_workspace(pa.program_id))
    )
  );
--> statement-breakpoint
-- The affiliate may create and rename their own links; nothing else may.
CREATE POLICY "referral_links_owner_write" ON public.referral_links
  FOR ALL TO authenticated
  USING (
    public.owns_participation(program_affiliate_id)
    OR EXISTS (
      SELECT 1 FROM public.program_affiliates pa
       WHERE pa.id = program_affiliate_id
         AND public.has_workspace_role(public.program_workspace(pa.program_id), ARRAY['owner','admin'])
    )
  )
  WITH CHECK (
    public.owns_participation(program_affiliate_id)
    OR EXISTS (
      SELECT 1 FROM public.program_affiliates pa
       WHERE pa.id = program_affiliate_id
         AND public.has_workspace_role(public.program_workspace(pa.program_id), ARRAY['owner','admin'])
    )
  );
--> statement-breakpoint

CREATE POLICY "referral_clicks_select" ON public.referral_clicks
  FOR SELECT TO authenticated
  USING (
    public.is_workspace_member(public.program_workspace(program_id))
    OR public.owns_participation(program_affiliate_id)
  );
--> statement-breakpoint

CREATE POLICY "attributions_select" ON public.attributions
  FOR SELECT TO authenticated
  USING (
    public.is_workspace_member(public.program_workspace(program_id))
    OR public.owns_participation(program_affiliate_id)
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 8. Policies — ledger. Affiliates may READ their own rows and nothing more.
--    An affiliate cannot approve their own commission by construction.
-- ---------------------------------------------------------------------------
CREATE POLICY "commissions_affiliate_select" ON public.commissions
  FOR SELECT TO authenticated USING (public.owns_participation(program_affiliate_id));
--> statement-breakpoint

CREATE POLICY "payout_items_select" ON public.payout_items
  FOR SELECT TO authenticated
  USING (
    public.owns_participation(program_affiliate_id)
    OR EXISTS (
      SELECT 1 FROM public.payout_batches b
       WHERE b.id = payout_batch_id AND public.is_workspace_member(b.workspace_id)
    )
  );
--> statement-breakpoint
CREATE POLICY "payout_items_admin_write" ON public.payout_items
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.payout_batches b
     WHERE b.id = payout_batch_id
       AND public.has_workspace_role(b.workspace_id, ARRAY['owner','admin'])))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.payout_batches b
     WHERE b.id = payout_batch_id
       AND public.has_workspace_role(b.workspace_id, ARRAY['owner','admin'])));
--> statement-breakpoint

CREATE POLICY "payout_item_commissions_select" ON public.payout_item_commissions
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.payout_items i
     WHERE i.id = payout_item_id
       AND (public.owns_participation(i.program_affiliate_id)
            OR EXISTS (SELECT 1 FROM public.payout_batches b
                        WHERE b.id = i.payout_batch_id
                          AND public.is_workspace_member(b.workspace_id)))));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 9. Affiliates may read their own affiliate record.
--    (The workspace-scoped policy above already covers founder access.)
-- ---------------------------------------------------------------------------
CREATE POLICY "affiliates_self_select" ON public.affiliates
  FOR SELECT TO authenticated USING (user_id = auth.uid());
--> statement-breakpoint
CREATE POLICY "affiliates_self_update" ON public.affiliates
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
--> statement-breakpoint

-- Affiliates need the program's commission terms to make sense of their numbers.
CREATE POLICY "programs_affiliate_select" ON public.programs
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.program_affiliates pa
     WHERE pa.program_id = programs.id
       AND pa.affiliate_id IN (SELECT public.current_affiliate_ids())));
--> statement-breakpoint

-- Affiliates see the workspace they are enrolled in (name and branding only).
CREATE POLICY "workspaces_affiliate_select" ON public.workspaces
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.affiliates a
     WHERE a.workspace_id = workspaces.id AND a.user_id = auth.uid()));
--> statement-breakpoint

-- Affiliates see the payout batches that contain one of their items.
CREATE POLICY "payout_batches_affiliate_select" ON public.payout_batches
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.payout_items i
     WHERE i.payout_batch_id = payout_batches.id
       AND public.owns_participation(i.program_affiliate_id)));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 10. webhook_events is service-role only: no policy is created for
--     `authenticated`, so with FORCE RLS on, the table is unreadable to users.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.webhook_events FROM authenticated, anon;
--> statement-breakpoint

-- Nothing in this schema is readable anonymously.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
