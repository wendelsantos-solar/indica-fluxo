CREATE TYPE "public"."workspace_plan" AS ENUM('starter', 'growth');--> statement-breakpoint
CREATE TABLE "plan_upgrade_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"requested_plan" "workspace_plan" NOT NULL,
	"requested_by" uuid NOT NULL,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "plan" "workspace_plan" DEFAULT 'starter' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_upgrade_requests" ADD CONSTRAINT "plan_upgrade_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_upgrade_requests_workspace_idx" ON "plan_upgrade_requests" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "plan_upgrade_requests_open_key" ON "plan_upgrade_requests" USING btree ("workspace_id","requested_plan") WHERE handled_at is null;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Handwritten: plans are not self-serve.
--
-- 0001 granted table-wide UPDATE on workspaces to `authenticated`, and RLS has
-- no column scope, so an owner/admin could set `plan = 'growth'` through the
-- Supabase API. Replace the table grant with a column grant that leaves `plan`
-- (and ids/timestamps of creation) out. The operator changes plans with the
-- service connection.
-- ---------------------------------------------------------------------------
REVOKE UPDATE ON public.workspaces FROM authenticated;
--> statement-breakpoint
GRANT UPDATE (name, slug, logo_url, default_currency, timezone, updated_at) ON public.workspaces TO authenticated;
--> statement-breakpoint

ALTER TABLE public.plan_upgrade_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.plan_upgrade_requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Members read their workspace's requests; owners/admins file one, as
-- themselves. No UPDATE/DELETE for `authenticated`: handling is operator-only.
GRANT SELECT, INSERT ON public.plan_upgrade_requests TO authenticated;
--> statement-breakpoint
CREATE POLICY "plan_upgrade_requests_member_select" ON public.plan_upgrade_requests
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY "plan_upgrade_requests_admin_insert" ON public.plan_upgrade_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND handled_at IS NULL
    AND public.has_workspace_role(workspace_id, ARRAY['owner','admin'])
  );
