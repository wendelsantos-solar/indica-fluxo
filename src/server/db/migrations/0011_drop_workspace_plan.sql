-- The plan now lives in `workspace_subscriptions` (migration 0010 copied the
-- only commercial state `workspaces.plan` held — operator-granted `growth` — into
-- a `manual` subscription). Requests keep their plan in the new vocabulary;
-- `starter` was never requestable, but maps to `launch` for safety.
ALTER TABLE "plan_upgrade_requests" ALTER COLUMN "requested_plan" SET DATA TYPE "public"."plan_code"
  USING (CASE "requested_plan"::text WHEN 'starter' THEN 'launch' ELSE "requested_plan"::text END)::"public"."plan_code";--> statement-breakpoint
ALTER TABLE "workspaces" DROP COLUMN "plan";--> statement-breakpoint
DROP TYPE "public"."workspace_plan";
