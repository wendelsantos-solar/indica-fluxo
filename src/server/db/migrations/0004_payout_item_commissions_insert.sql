-- ============================================================================
-- 0004 — corrective. Postgres 42501 on public.payout_item_commissions.
-- Handwritten: drizzle-kit does not model policies or privileges.
-- Idempotent; safe to apply to a database that already ran 0001-0003.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0001 gave `payout_item_commissions` a SELECT policy and no write policy at
-- all. With RLS ENABLEd and FORCEd, "no policy" means "no row passes", so the
-- join rows `createPayoutBatch()` writes were rejected outright — the same code
-- path 0003 unblocked, failing one statement further down.
--
-- The rule mirrors `payout_items_admin_write`: an owner/admin of the workspace
-- that owns the batch. It is deliberately `FOR INSERT` rather than `FOR ALL`.
-- This table is part of the financial ledger (CLAUDE.md §9, DATABASE.md §4):
-- a payout's composition is a historical fact, and nothing in the service layer
-- updates or deletes these rows — `createPayoutBatch()` only inserts them, and
-- `markBatchPaid()` only reads them. Demo teardown runs on the Drizzle service
-- connection, which does not go through RLS.
--
-- The matching table privileges are revoked too: 0001 granted
-- SELECT/INSERT/UPDATE/DELETE to `authenticated` in a loop over every tenant
-- table, so without this REVOKE a future `FOR ALL` policy would silently
-- re-open mutation of settled payout history.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "payout_item_commissions_admin_insert" ON public.payout_item_commissions;
--> statement-breakpoint
CREATE POLICY "payout_item_commissions_admin_insert" ON public.payout_item_commissions
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.payout_items i
     WHERE i.id = payout_item_id
       AND public.has_workspace_role(
             public.payout_batch_workspace(i.payout_batch_id), ARRAY['owner','admin'])));
--> statement-breakpoint

REVOKE UPDATE, DELETE ON public.payout_item_commissions FROM authenticated;
