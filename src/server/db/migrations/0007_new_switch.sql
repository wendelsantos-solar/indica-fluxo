CREATE TABLE "transaction_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" "billing_provider" NOT NULL,
	"reference_id" text NOT NULL,
	"provider_transaction_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transaction_references" ADD CONSTRAINT "transaction_references_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_references_key" ON "transaction_references" USING btree ("workspace_id","provider","reference_id");--> statement-breakpoint
CREATE INDEX "webhook_events_workspace_time_idx" ON "webhook_events" USING btree ("workspace_id","received_at" DESC NULLS LAST);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Handwritten: the latest webhook event of a workspace, for members.
--
-- `webhook_events` stays closed to `authenticated` (0001 §10): its rows carry
-- payload hashes and raw error text, and events with no workspace yet. The
-- Integrations page only needs "when did the last event arrive, of which type,
-- and did it fail", so members get exactly that through a narrow definer
-- function instead of a table policy. `search_path = ''` so nothing in it can
-- be shadowed; every name is schema-qualified.
-- ---------------------------------------------------------------------------
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
     AND public.is_workspace_member(p_workspace_id)
   ORDER BY e.received_at DESC
   LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.latest_webhook_event(uuid) FROM public;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.latest_webhook_event(uuid) FROM anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.latest_webhook_event(uuid) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Handwritten: transaction_references is ingest-only, like webhook_events.
-- Written by the Stripe webhook path on the service connection; no user reads
-- it. RLS on and forced with no policy, and no grants for API roles.
-- ---------------------------------------------------------------------------
ALTER TABLE public.transaction_references ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.transaction_references FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.transaction_references FROM authenticated, anon;
