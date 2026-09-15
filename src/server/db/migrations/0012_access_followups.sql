-- ---------------------------------------------------------------------------
-- Follow-ups to the plans work (docs/PLANS.md).
-- ---------------------------------------------------------------------------

-- 1. Integrations' "last event": founder-billing events only, and per
--    environment. Platform-billing events (IndicaFluxo's own invoices) are not
--    the founder's Stripe traffic.
CREATE OR REPLACE FUNCTION public.latest_webhook_event(p_workspace_id uuid)
RETURNS TABLE (received_at timestamptz, event_type text, status public.webhook_status)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT e.received_at, e.event_type, e.status
    FROM public.webhook_events e
   WHERE e.workspace_id = p_workspace_id
     AND e.scope = 'customer_billing'
     AND public.is_workspace_member(p_workspace_id)
   ORDER BY e.received_at DESC
   LIMIT 1;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.latest_webhook_event(p_workspace_id uuid, p_environment public.environment)
RETURNS TABLE (received_at timestamptz, event_type text, status public.webhook_status)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT e.received_at, e.event_type, e.status
    FROM public.webhook_events e
   WHERE e.workspace_id = p_workspace_id
     AND e.scope = 'customer_billing'
     AND e.environment = p_environment
     AND public.is_workspace_member(p_workspace_id)
   ORDER BY e.received_at DESC
   LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.latest_webhook_event(uuid, public.environment) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.latest_webhook_event(uuid, public.environment) TO indica_app;
--> statement-breakpoint

-- 2. Any member may leave a workspace. The services refuse the last owner
--    (`checkMemberChange`); the policy only allows removing one's own row.
CREATE POLICY "workspace_members_self_delete" ON public.workspace_members
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());
--> statement-breakpoint

-- 3. Audit rows for actions that non-admins may take (an affiliate creating a
--    link, a member leaving). Only as oneself, only for a workspace one belongs
--    to or is an affiliate of. Rows stay immutable (0009 revoked UPDATE/DELETE).
CREATE POLICY "audit_logs_actor_insert" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_user_id = auth.uid()
    AND (
      public.is_workspace_member(workspace_id)
      OR EXISTS (
        SELECT 1 FROM public.affiliates a
         WHERE a.workspace_id = audit_logs.workspace_id
           AND a.id IN (SELECT public.current_affiliate_ids())
      )
    )
  );
