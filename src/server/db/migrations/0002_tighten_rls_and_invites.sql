-- ============================================================================
-- 0002 — corrective. Findings P0-1, P1-1 and P1-2 of AUDIT_REPORT.md.
-- Handwritten: drizzle-kit does not model policies or privileges.
-- Additive and idempotent; safe to apply to a database that already ran 0001.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- P0-1. `affiliates_self_update` was column-blind.
--
-- Postgres RLS has no column scope, and `WITH CHECK (user_id = auth.uid())`
-- only asserts that the row still belongs to the caller afterwards. It said
-- nothing about `workspace_id` or `status`, so any affiliate could re-activate
-- themselves after suspension, or move their row into another tenant — the one
-- column the whole isolation model is built on (ARCHITECTURE.md §2).
--
-- No product surface writes to `affiliates` on an affiliate's behalf: the
-- portal's settings page is read-only, and the only writer is
-- `setParticipationStatus()`, which runs under `requireMembership(…, 'admin')`.
-- So the policy is removed rather than narrowed.
--
-- If affiliate self-service editing is added later, RLS cannot express it alone
-- (WITH CHECK cannot compare OLD to NEW). It needs a BEFORE UPDATE trigger that
-- restores workspace_id, user_id, email and status when the actor is not an
-- admin. Do not simply re-create this policy.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "affiliates_self_update" ON public.affiliates;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- P1-1. The ledger is append-mostly (CLAUDE.md rule 9, DATABASE.md §3), but
-- 0001 granted DELETE on every table to `authenticated`, and the
-- `<t>_admin_write` policies are FOR ALL. An owner/admin session could
-- therefore delete a commission or a transaction outright.
--
-- UPDATE must stay: `createPayoutBatch()` flips `commissions.status` under
-- `withUser()`. DELETE is used by no code path at all.
--
-- The seed's reset deletes ledger rows, but it runs on the Drizzle service
-- connection (`DATABASE_URL`), which is not the `authenticated` role.
-- ---------------------------------------------------------------------------
REVOKE DELETE ON public.commissions FROM authenticated;
--> statement-breakpoint
REVOKE DELETE ON public.transactions FROM authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- P1-2. `workspace_invites` deduplicated invites case-sensitively while
-- `handle_new_user()` claims them case-insensitively
-- (`lower(i.email) = lower(NEW.email)`), so `Bob@acme.com` and `bob@acme.com`
-- were two accepted pending invites for one person.
--
-- `affiliates_workspace_email_key` already uses `lower(email)`; this brings
-- invites in line with it and with DATABASE.md §3.
--
-- Deduplicate first: keep the oldest invite per (workspace, lower(email)),
-- because the index cannot be created while collisions exist. Only unaccepted
-- rows are touched — accepted invites are history and are left alone.
-- ---------------------------------------------------------------------------
DELETE FROM public.workspace_invites a
 USING public.workspace_invites b
 WHERE a.accepted_at IS NULL
   AND b.accepted_at IS NULL
   AND a.workspace_id = b.workspace_id
   AND lower(a.email) = lower(b.email)
   AND (a.created_at, a.id) > (b.created_at, b.id);
--> statement-breakpoint

DROP INDEX IF EXISTS "workspace_invites_pending_key";
--> statement-breakpoint

CREATE UNIQUE INDEX "workspace_invites_pending_key"
  ON "workspace_invites" USING btree ("workspace_id", lower("email"))
  WHERE accepted_at IS NULL;
