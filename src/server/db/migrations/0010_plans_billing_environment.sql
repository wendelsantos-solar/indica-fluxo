CREATE TYPE "public"."environment" AS ENUM('test', 'live');--> statement-breakpoint
CREATE TYPE "public"."plan_code" AS ENUM('sandbox', 'launch', 'growth', 'scale');--> statement-breakpoint
CREATE TYPE "public"."platform_subscription_status" AS ENUM('free', 'trialing', 'active', 'past_due', 'cancelled', 'incomplete');--> statement-breakpoint
CREATE TYPE "public"."webhook_scope" AS ENUM('customer_billing', 'platform_billing');--> statement-breakpoint
CREATE TABLE "workspace_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"plan" "plan_code" DEFAULT 'sandbox' NOT NULL,
	"status" "platform_subscription_status" DEFAULT 'free' NOT NULL,
	"provider" "billing_provider",
	"provider_customer_id" text,
	"provider_subscription_id" text,
	"provider_price_id" text,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"trial_started_at" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"past_due_since" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"provider_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "webhook_events_provider_event_key";--> statement-breakpoint
DROP INDEX "customers_workspace_provider_customer_key";--> statement-breakpoint
DROP INDEX "customers_workspace_external_key";--> statement-breakpoint
DROP INDEX "payout_batches_workspace_reference_key";--> statement-breakpoint
DROP INDEX "api_keys_workspace_idx";--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD COLUMN "expires_at" timestamp with time zone DEFAULT now() + interval '14 days' NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "environment" "environment" DEFAULT 'test' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "environment" "environment" DEFAULT 'test' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "environment" "environment" DEFAULT 'test' NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_batches" ADD COLUMN "environment" "environment" DEFAULT 'test' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "environment" "environment" DEFAULT 'test' NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "scope" "webhook_scope" DEFAULT 'customer_billing' NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "environment" "environment";--> statement-breakpoint
ALTER TABLE "workspace_subscriptions" ADD CONSTRAINT "workspace_subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_subscriptions_workspace_key" ON "workspace_subscriptions" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_subscriptions_provider_subscription_key" ON "workspace_subscriptions" USING btree ("provider","provider_subscription_id") WHERE provider_subscription_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_subscriptions_provider_customer_key" ON "workspace_subscriptions" USING btree ("provider","provider_customer_id") WHERE provider_customer_id is not null;--> statement-breakpoint
CREATE INDEX "programs_workspace_environment_idx" ON "programs" USING btree ("workspace_id","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_scope_provider_event_key" ON "webhook_events" USING btree ("scope","provider","provider_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_workspace_provider_customer_key" ON "customers" USING btree ("workspace_id","environment","provider","provider_customer_id") WHERE provider_customer_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_workspace_external_key" ON "customers" USING btree ("workspace_id","environment","external_id") WHERE external_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payout_batches_workspace_reference_key" ON "payout_batches" USING btree ("workspace_id","environment","reference");--> statement-breakpoint
CREATE INDEX "api_keys_workspace_idx" ON "api_keys" USING btree ("workspace_id","environment","type");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Handwritten: backfill, access and the usage function. See docs/PLANS.md.
-- ---------------------------------------------------------------------------

-- Everything that exists today was produced by real keys and real Stripe
-- events: it is live data. New rows state their environment explicitly.
UPDATE public.programs SET environment = 'live';
--> statement-breakpoint
UPDATE public.customers SET environment = 'live';
--> statement-breakpoint
UPDATE public.transactions SET environment = 'live';
--> statement-breakpoint
UPDATE public.payout_batches SET environment = 'live';
--> statement-breakpoint
UPDATE public.api_keys SET environment = 'live';
--> statement-breakpoint

-- A workspace on `growth` got there only by an operator after a commercial
-- agreement (README, "Mudar o plano"): that is a real subscription, recorded as
-- `manual`. `starter` was the free tier and becomes Sandbox — no row. Nothing
-- is invented: no workspace becomes Launch.
INSERT INTO public.workspace_subscriptions (workspace_id, plan, status, provider, current_period_start)
SELECT w.id, 'growth', 'active', 'manual', now()
  FROM public.workspaces w
 WHERE w.plan = 'growth'
ON CONFLICT (workspace_id) DO NOTHING;
--> statement-breakpoint

ALTER TABLE public.workspace_subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.workspace_subscriptions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Read-only for the app: only the billing webhook (service connection) and the
-- operator write a subscription.
GRANT SELECT ON public.workspace_subscriptions TO indica_app;
--> statement-breakpoint
CREATE POLICY "workspace_subscriptions_member_select" ON public.workspace_subscriptions
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint

-- What counts toward a plan's limits, in one place, for every member role.
-- (Counted under RLS, a `member` cannot see pending invites and would undercount.)
--   programs  — not archived, per environment. Archiving frees a slot; restoring
--               an archived program re-checks the limit.
--   affiliates — not suspended, with at least one pending or approved
--               participation in this workspace. Rejecting or suspending frees
--               a slot; approving again re-checks.
--   members   — members, plus invitations not accepted and not expired.
CREATE OR REPLACE FUNCTION public.workspace_plan_usage(p_workspace_id uuid)
RETURNS TABLE (live_programs integer, test_programs integer, affiliates integer, members integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    (SELECT count(*)::int FROM public.programs p
      WHERE p.workspace_id = p_workspace_id AND p.status <> 'archived' AND p.environment = 'live'),
    (SELECT count(*)::int FROM public.programs p
      WHERE p.workspace_id = p_workspace_id AND p.status <> 'archived' AND p.environment = 'test'),
    (SELECT count(DISTINCT a.id)::int FROM public.affiliates a
       JOIN public.program_affiliates pa ON pa.affiliate_id = a.id
       JOIN public.programs p ON p.id = pa.program_id AND p.workspace_id = p_workspace_id
      WHERE a.workspace_id = p_workspace_id
        AND a.status <> 'suspended'
        AND pa.status IN ('pending', 'approved')),
    (SELECT count(*)::int FROM public.workspace_members m WHERE m.workspace_id = p_workspace_id)
      + (SELECT count(*)::int FROM public.workspace_invites i
          WHERE i.workspace_id = p_workspace_id AND i.accepted_at IS NULL AND i.expires_at > now())
  WHERE public.is_workspace_member(p_workspace_id)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.workspace_plan_usage(uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.workspace_plan_usage(uuid) TO indica_app;
--> statement-breakpoint

-- Expired invitations are no longer claimed, at sign-up or at sign-in.
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

  UPDATE public.affiliates
     SET user_id = NEW.id, status = 'active', updated_at = now()
   WHERE user_id IS NULL
     AND lower(email) = lower(NEW.email);

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  SELECT i.workspace_id, NEW.id, i.role
    FROM public.workspace_invites i
   WHERE i.accepted_at IS NULL
     AND i.expires_at > now()
     AND lower(i.email) = lower(NEW.email)
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  UPDATE public.workspace_invites
     SET accepted_at = now()
   WHERE accepted_at IS NULL
     AND expires_at > now()
     AND lower(email) = lower(NEW.email);

  RETURN NEW;
END;
$$;
--> statement-breakpoint
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
     AND i.expires_at > now()
     AND lower(i.email) = lower(v_email)
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  UPDATE public.workspace_invites
     SET accepted_at = now()
   WHERE accepted_at IS NULL
     AND expires_at > now()
     AND lower(email) = lower(v_email);
END;
$$;
