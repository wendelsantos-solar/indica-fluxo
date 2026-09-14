CREATE TYPE "public"."affiliate_status" AS ENUM('invited', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."api_key_type" AS ENUM('publishable', 'secret');--> statement-breakpoint
CREATE TYPE "public"."attribution_model" AS ENUM('first_click', 'last_click');--> statement-breakpoint
CREATE TYPE "public"."billing_provider" AS ENUM('stripe', 'paddle', 'manual');--> statement-breakpoint
CREATE TYPE "public"."commission_status" AS ENUM('pending', 'available', 'approved', 'paid', 'reversed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."commission_type" AS ENUM('percentage', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."device_type" AS ENUM('desktop', 'mobile', 'tablet', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('connected', 'disconnected', 'error');--> statement-breakpoint
CREATE TYPE "public"."payout_batch_status" AS ENUM('draft', 'approved', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payout_item_status" AS ENUM('pending', 'paid', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."program_affiliate_status" AS ENUM('pending', 'approved', 'rejected', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."program_status" AS ENUM('draft', 'active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."subscription_interval" AS ENUM('day', 'week', 'month', 'year', 'one_time');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'cancelled', 'incomplete');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('succeeded', 'pending', 'failed');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('payment', 'refund', 'chargeback', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."webhook_status" AS ENUM('received', 'processed', 'failed', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."workspace_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"full_name" text,
	"avatar_url" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "workspace_role" DEFAULT 'member' NOT NULL,
	"invited_by" uuid,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "workspace_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo_url" text,
	"default_currency" char(3) DEFAULT 'USD' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "affiliates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"company_name" text,
	"country" char(2),
	"status" "affiliate_status" DEFAULT 'invited' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_affiliates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"affiliate_id" uuid NOT NULL,
	"code" text NOT NULL,
	"status" "program_affiliate_status" DEFAULT 'pending' NOT NULL,
	"custom_commission_type" "commission_type",
	"custom_commission_value" integer,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "program_affiliates_code_format" CHECK ("program_affiliates"."code" ~ '^[a-z0-9][a-z0-9_-]{1,48}$'),
	CONSTRAINT "program_affiliates_custom_rate_pairing" CHECK (("program_affiliates"."custom_commission_type" is null) = ("program_affiliates"."custom_commission_value" is null))
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"status" "program_status" DEFAULT 'draft' NOT NULL,
	"commission_type" "commission_type" DEFAULT 'percentage' NOT NULL,
	"commission_value" integer NOT NULL,
	"commission_duration_months" integer,
	"attribution_model" "attribution_model" DEFAULT 'last_click' NOT NULL,
	"attribution_window_days" integer DEFAULT 60 NOT NULL,
	"commission_hold_days" integer DEFAULT 30 NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "programs_commission_value_positive" CHECK ("programs"."commission_value" > 0),
	CONSTRAINT "programs_attribution_window_sane" CHECK ("programs"."attribution_window_days" between 1 and 365),
	CONSTRAINT "programs_hold_days_sane" CHECK ("programs"."commission_hold_days" between 0 and 180),
	CONSTRAINT "programs_duration_sane" CHECK ("programs"."commission_duration_months" is null or "programs"."commission_duration_months" between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "referral_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_affiliate_id" uuid NOT NULL,
	"name" text NOT NULL,
	"destination_url" text NOT NULL,
	"code" text NOT NULL,
	"campaign" text,
	"click_count_cached" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"program_affiliate_id" uuid NOT NULL,
	"visitor_id" text NOT NULL,
	"customer_external_id" text,
	"provider_customer_id" text,
	"first_click_id" uuid,
	"last_click_id" uuid,
	"attribution_model" "attribution_model" NOT NULL,
	"attributed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"program_affiliate_id" uuid NOT NULL,
	"referral_link_id" uuid,
	"visitor_id" text NOT NULL,
	"landing_url" text NOT NULL,
	"referrer_url" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"country" char(2),
	"device_type" "device_type" DEFAULT 'unknown' NOT NULL,
	"ip_hash" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"program_id" uuid,
	"external_id" text,
	"provider" "billing_provider" NOT NULL,
	"provider_customer_id" text,
	"email_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"provider" "billing_provider" NOT NULL,
	"provider_subscription_id" text NOT NULL,
	"status" "subscription_status" NOT NULL,
	"currency" char(3) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"interval" "subscription_interval" DEFAULT 'month' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"subscription_id" uuid,
	"provider" "billing_provider" NOT NULL,
	"provider_transaction_id" text NOT NULL,
	"provider_parent_transaction_id" text,
	"type" "transaction_type" NOT NULL,
	"status" "transaction_status" DEFAULT 'succeeded' NOT NULL,
	"currency" char(3) NOT NULL,
	"gross_amount_minor" bigint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"program_affiliate_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"base_amount_minor" bigint NOT NULL,
	"commission_rate" integer,
	"commission_amount_minor" bigint NOT NULL,
	"status" "commission_status" DEFAULT 'pending' NOT NULL,
	"eligible_at" timestamp with time zone NOT NULL,
	"reversal_of_commission_id" uuid,
	"rule_applied" text,
	"approved_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"currency" char(3) NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"status" "payout_batch_status" DEFAULT 'draft' NOT NULL,
	"total_amount_minor" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payout_item_commissions" (
	"payout_item_id" uuid NOT NULL,
	"commission_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payout_batch_id" uuid NOT NULL,
	"program_affiliate_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "payout_item_status" DEFAULT 'pending' NOT NULL,
	"external_reference" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "api_key_type" NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"action" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" "billing_provider" NOT NULL,
	"provider_account_id" text,
	"status" "integration_status" DEFAULT 'disconnected' NOT NULL,
	"encrypted_credentials" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"connected_at" timestamp with time zone,
	"disconnected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "billing_provider" NOT NULL,
	"workspace_id" uuid,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_hash" text NOT NULL,
	"status" "webhook_status" DEFAULT 'received' NOT NULL,
	"error_message" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliates" ADD CONSTRAINT "affiliates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_affiliates" ADD CONSTRAINT "program_affiliates_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_affiliates" ADD CONSTRAINT "program_affiliates_affiliate_id_affiliates_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "public"."affiliates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_links" ADD CONSTRAINT "referral_links_program_affiliate_id_program_affiliates_id_fk" FOREIGN KEY ("program_affiliate_id") REFERENCES "public"."program_affiliates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attributions" ADD CONSTRAINT "attributions_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attributions" ADD CONSTRAINT "attributions_program_affiliate_id_program_affiliates_id_fk" FOREIGN KEY ("program_affiliate_id") REFERENCES "public"."program_affiliates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attributions" ADD CONSTRAINT "attributions_first_click_id_referral_clicks_id_fk" FOREIGN KEY ("first_click_id") REFERENCES "public"."referral_clicks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attributions" ADD CONSTRAINT "attributions_last_click_id_referral_clicks_id_fk" FOREIGN KEY ("last_click_id") REFERENCES "public"."referral_clicks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_clicks" ADD CONSTRAINT "referral_clicks_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_clicks" ADD CONSTRAINT "referral_clicks_program_affiliate_id_program_affiliates_id_fk" FOREIGN KEY ("program_affiliate_id") REFERENCES "public"."program_affiliates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_clicks" ADD CONSTRAINT "referral_clicks_referral_link_id_referral_links_id_fk" FOREIGN KEY ("referral_link_id") REFERENCES "public"."referral_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_program_affiliate_id_program_affiliates_id_fk" FOREIGN KEY ("program_affiliate_id") REFERENCES "public"."program_affiliates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_item_commissions" ADD CONSTRAINT "payout_item_commissions_payout_item_id_payout_items_id_fk" FOREIGN KEY ("payout_item_id") REFERENCES "public"."payout_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_item_commissions" ADD CONSTRAINT "payout_item_commissions_commission_id_commissions_id_fk" FOREIGN KEY ("commission_id") REFERENCES "public"."commissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_payout_batch_id_payout_batches_id_fk" FOREIGN KEY ("payout_batch_id") REFERENCES "public"."payout_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_program_affiliate_id_program_affiliates_id_fk" FOREIGN KEY ("program_affiliate_id") REFERENCES "public"."program_affiliates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invites_pending_key" ON "workspace_invites" USING btree ("workspace_id","email") WHERE accepted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_workspace_user_key" ON "workspace_members" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "affiliates_workspace_email_key" ON "affiliates" USING btree ("workspace_id",lower("email"));--> statement-breakpoint
CREATE INDEX "affiliates_workspace_status_idx" ON "affiliates" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "affiliates_user_idx" ON "affiliates" USING btree ("user_id") WHERE user_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "program_affiliates_program_code_key" ON "program_affiliates" USING btree ("program_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "program_affiliates_program_affiliate_key" ON "program_affiliates" USING btree ("program_id","affiliate_id");--> statement-breakpoint
CREATE INDEX "program_affiliates_affiliate_idx" ON "program_affiliates" USING btree ("affiliate_id");--> statement-breakpoint
CREATE INDEX "program_affiliates_program_status_idx" ON "program_affiliates" USING btree ("program_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "programs_workspace_slug_key" ON "programs" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "programs_workspace_status_idx" ON "programs" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_links_participation_code_key" ON "referral_links" USING btree ("program_affiliate_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "attributions_program_visitor_key" ON "attributions" USING btree ("program_id","visitor_id");--> statement-breakpoint
CREATE INDEX "attributions_provider_customer_idx" ON "attributions" USING btree ("provider_customer_id") WHERE provider_customer_id is not null;--> statement-breakpoint
CREATE INDEX "attributions_external_customer_idx" ON "attributions" USING btree ("customer_external_id") WHERE customer_external_id is not null;--> statement-breakpoint
CREATE INDEX "attributions_participation_idx" ON "attributions" USING btree ("program_affiliate_id");--> statement-breakpoint
CREATE INDEX "referral_clicks_program_time_idx" ON "referral_clicks" USING btree ("program_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "referral_clicks_participation_time_idx" ON "referral_clicks" USING btree ("program_affiliate_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "referral_clicks_visitor_idx" ON "referral_clicks" USING btree ("visitor_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "referral_clicks_link_idx" ON "referral_clicks" USING btree ("referral_link_id") WHERE referral_link_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_workspace_provider_customer_key" ON "customers" USING btree ("workspace_id","provider","provider_customer_id") WHERE provider_customer_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_workspace_external_key" ON "customers" USING btree ("workspace_id","external_id") WHERE external_id is not null;--> statement-breakpoint
CREATE INDEX "customers_workspace_idx" ON "customers" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_provider_key" ON "subscriptions" USING btree ("provider","provider_subscription_id");--> statement-breakpoint
CREATE INDEX "subscriptions_customer_idx" ON "subscriptions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "subscriptions_workspace_status_idx" ON "subscriptions" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_provider_key" ON "transactions" USING btree ("workspace_id","provider","provider_transaction_id");--> statement-breakpoint
CREATE INDEX "transactions_workspace_time_idx" ON "transactions" USING btree ("workspace_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_customer_idx" ON "transactions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "transactions_subscription_idx" ON "transactions" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "transactions_parent_idx" ON "transactions" USING btree ("provider_parent_transaction_id") WHERE provider_parent_transaction_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "commissions_transaction_participation_key" ON "commissions" USING btree ("transaction_id","program_affiliate_id") WHERE reversal_of_commission_id is null;--> statement-breakpoint
CREATE INDEX "commissions_workspace_status_idx" ON "commissions" USING btree ("workspace_id","status","eligible_at");--> statement-breakpoint
CREATE INDEX "commissions_participation_status_idx" ON "commissions" USING btree ("program_affiliate_id","status");--> statement-breakpoint
CREATE INDEX "commissions_transaction_idx" ON "commissions" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "commissions_program_idx" ON "commissions" USING btree ("program_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payout_batches_workspace_idx" ON "payout_batches" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "payout_batches_workspace_reference_key" ON "payout_batches" USING btree ("workspace_id","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_item_commissions_key" ON "payout_item_commissions" USING btree ("payout_item_id","commission_id");--> statement-breakpoint
CREATE INDEX "payout_item_commissions_commission_idx" ON "payout_item_commissions" USING btree ("commission_id");--> statement-breakpoint
CREATE INDEX "payout_items_batch_idx" ON "payout_items" USING btree ("payout_batch_id");--> statement-breakpoint
CREATE INDEX "payout_items_participation_idx" ON "payout_items" USING btree ("program_affiliate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_items_batch_participation_key" ON "payout_items" USING btree ("payout_batch_id","program_affiliate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_key" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_workspace_idx" ON "api_keys" USING btree ("workspace_id","type");--> statement-breakpoint
CREATE INDEX "audit_logs_workspace_time_idx" ON "audit_logs" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_workspace_provider_key" ON "integrations" USING btree ("workspace_id","provider");--> statement-breakpoint
CREATE INDEX "integrations_account_idx" ON "integrations" USING btree ("provider","provider_account_id") WHERE provider_account_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_event_key" ON "webhook_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "webhook_events_status_idx" ON "webhook_events" USING btree ("status","received_at" DESC NULLS LAST);