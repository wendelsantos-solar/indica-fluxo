-- The public attribution reference (INTEGRATION_ARCHITECTURE_V2.md §2, §7).
--
-- One new table, no existing row rewritten. It holds the peppered hash of a
-- token the tracker mints on a click that produced an eligible attribution;
-- that token travels through Stripe (`client_reference_id`, metadata) and comes
-- back on a webhook, which is how a founder stops having to call
-- `POST /api/identify` from their backend.
--
-- Written only on the anonymous ingest path (the service connection, like
-- `referral_clicks`) and on the webhook ingest path. There is no client write
-- path at all, so the policies below are SELECT-only: a token must never be
-- enumerable by anything but a member of the workspace that owns it, and even
-- then only its prefix is meaningful — the plaintext is not stored.
CREATE TABLE "attribution_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "environment" "environment" NOT NULL,
  "visitor_id" text NOT NULL,
  "token_hash" text NOT NULL,
  "token_prefix" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "bound_provider_customer_id" text,
  "bound_at" timestamp with time zone,
  "issued_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attribution_tokens"
  ADD CONSTRAINT "attribution_tokens_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "attribution_tokens_hash_key" ON "attribution_tokens" USING btree ("token_hash");
--> statement-breakpoint
-- The next click of a visitor who already holds a token reuses that row instead
-- of adding one per click to a table that would otherwise track click volume.
CREATE INDEX "attribution_tokens_visitor_idx" ON "attribution_tokens" USING btree ("workspace_id","environment","visitor_id");
--> statement-breakpoint
CREATE INDEX "attribution_tokens_workspace_idx" ON "attribution_tokens" USING btree ("workspace_id","issued_at" DESC NULLS LAST);
--> statement-breakpoint

ALTER TABLE "attribution_tokens" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Members read their workspace's references (Integration diagnostics). Nothing
-- else: no INSERT, UPDATE or DELETE policy exists for `authenticated`, so even
-- the app role — which is a member of `authenticated` (migration 0009) — can
-- only write through the service connection on the ingest paths.
CREATE POLICY "attribution_tokens_select" ON public.attribution_tokens
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint

-- The Supabase Data API keeps holding nothing on product tables (migration 0009).
GRANT SELECT ON public.attribution_tokens TO indica_app;
--> statement-breakpoint
REVOKE ALL ON public.attribution_tokens FROM anon, authenticated;
