-- ---------------------------------------------------------------------------
-- Claim invitations for people who already have an account.
--
-- `handle_new_user()` only runs when an auth user is created, so an invitation
-- addressed to an existing account (an affiliate joining a second program, a
-- founder invited to another workspace) was never claimed. This function does
-- the same three writes for the signed-in caller, reading the address from
-- `auth.users` — never from an argument — and only once that address is
-- confirmed, so nobody claims an invitation for an e-mail they don't control.
-- Called by the app after sign-in, after the auth callback and on `/app`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_pending_invites()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT u.email INTO v_email
    FROM auth.users u
   WHERE u.id = v_user_id
     AND u.email_confirmed_at IS NOT NULL;

  IF v_email IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.affiliates
     SET user_id = v_user_id, status = 'active', updated_at = now()
   WHERE user_id IS NULL
     AND lower(email) = lower(v_email);

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  SELECT i.workspace_id, v_user_id, i.role
    FROM public.workspace_invites i
   WHERE i.accepted_at IS NULL
     AND lower(i.email) = lower(v_email)
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  UPDATE public.workspace_invites
     SET accepted_at = now()
   WHERE accepted_at IS NULL
     AND lower(email) = lower(v_email);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.claim_pending_invites() FROM public, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.claim_pending_invites() TO authenticated;
