-- Payments Stripe delivered that could not enter the ledger because the event
-- carried no Stripe customer (Payment Links and one-off Checkout create none by
-- default). They are acknowledged to Stripe and marked `ignored`, so without
-- this count the Integrations panel would say "receiving events" while every
-- payment is being dropped.
--
-- Same shape as `latest_webhook_event` (0007/0012): SECURITY DEFINER, member
-- only, and it returns a number — never the raw error text, which is why
-- `webhook_events` itself stays closed (DATABASE.md §6). The reason string is
-- the one `billing-events.ts` writes; a test pins the two together.
CREATE OR REPLACE FUNCTION public.webhook_payments_without_customer(
  p_workspace_id uuid,
  p_environment public.environment,
  p_since timestamptz
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT count(*)
    FROM public.webhook_events e
   WHERE e.workspace_id = p_workspace_id
     AND e.scope = 'customer_billing'
     AND e.environment = p_environment
     AND e.received_at >= p_since
     AND e.status = 'ignored'
     AND e.error_message = 'payment has no customer'
     AND public.is_workspace_member(p_workspace_id);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.webhook_payments_without_customer(uuid, public.environment, timestamptz) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.webhook_payments_without_customer(uuid, public.environment, timestamptz) TO indica_app;
