-- ============================================================================
-- 0003 — corrective. Postgres 42P17 (infinite recursion) on public.payout_batches.
-- Handwritten: drizzle-kit does not model policies or privileges.
-- Idempotent; safe to apply to a database that already ran 0001 and 0002.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The recursion.
--
-- 0001 wrote two policies that read each other's table:
--
--   payout_batches_affiliate_select  -->  SELECT ... FROM payout_items
--   payout_items_select              -->  SELECT ... FROM payout_batches
--   payout_items_admin_write (FOR ALL, so it also applies to SELECT)
--                                    -->  SELECT ... FROM payout_batches
--
-- Reading either table therefore re-enters the other's policy, and Postgres
-- aborts with 42P17. It stayed hidden because the payouts page had never been
-- exercised against a seeded database: the failure only surfaces once a row is
-- actually read, and `createPayoutBatch()` reaches it through the RETURNING
-- clause of its INSERT — RETURNING makes Postgres evaluate the SELECT policies
-- of the table being written.
--
-- The fix follows the shape 0001 already uses for `program_workspace()`: resolve
-- the parent's workspace through a SECURITY DEFINER helper. The helper runs as
-- `postgres` (BYPASSRLS), so the lookup does not re-enter payout_batches' policy
-- and the cycle is cut, while the authorization rule itself is unchanged — the
-- batch remains the authority on which workspace a payout item belongs to.
--
-- Deriving the workspace from `program_affiliate_id` instead was rejected: it
-- would let an admin of workspace A attach an item to a batch in workspace B,
-- because nothing would then check the batch's tenant at all.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.payout_batch_workspace(b uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT workspace_id FROM public.payout_batches WHERE id = b;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- payout_items. Same rule as 0001 — own participation, or a member of the
-- batch's workspace — expressed without re-entering payout_batches' policy.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "payout_items_select" ON public.payout_items;
--> statement-breakpoint
CREATE POLICY "payout_items_select" ON public.payout_items
  FOR SELECT TO authenticated
  USING (
    public.owns_participation(program_affiliate_id)
    OR public.is_workspace_member(public.payout_batch_workspace(payout_batch_id))
  );
--> statement-breakpoint

DROP POLICY IF EXISTS "payout_items_admin_write" ON public.payout_items;
--> statement-breakpoint
CREATE POLICY "payout_items_admin_write" ON public.payout_items
  FOR ALL TO authenticated
  USING (
    public.has_workspace_role(
      public.payout_batch_workspace(payout_batch_id), ARRAY['owner','admin'])
  )
  WITH CHECK (
    public.has_workspace_role(
      public.payout_batch_workspace(payout_batch_id), ARRAY['owner','admin'])
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- payout_item_commissions. Not part of the cycle itself, but it inlined the
-- same payout_batches sub-select; routing it through the helper keeps the three
-- payout policies reading identically.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "payout_item_commissions_select" ON public.payout_item_commissions;
--> statement-breakpoint
CREATE POLICY "payout_item_commissions_select" ON public.payout_item_commissions
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.payout_items i
     WHERE i.id = payout_item_id
       AND (public.owns_participation(i.program_affiliate_id)
            OR public.is_workspace_member(
                 public.payout_batch_workspace(i.payout_batch_id)))));
