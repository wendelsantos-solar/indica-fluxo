import "server-only"

import { and, eq, inArray } from "drizzle-orm"

import { type Transaction, withUser } from "@/server/db"
import { affiliates, programAffiliates, referralLinks } from "@/server/db/schema"
import { NotFoundError } from "@/server/policies/errors"

/**
 * An affiliate's own named links. `referral_links_owner_write` (migration 0001)
 * lets the owning affiliate — or an admin of the program's workspace — update
 * and delete a link. The portal is the affiliate's own view, so these narrow
 * that further: only a link on one of the signed-in person's own participations
 * matches. An admin who is also an affiliate cannot reach another affiliate's
 * links through the portal. Anything else reads as "not found".
 */

/** The signed-in person's own participations, as a sub-query. */
function ownParticipationIds(tx: Transaction, userId: string) {
  return tx
    .select({ id: programAffiliates.id })
    .from(programAffiliates)
    .innerJoin(affiliates, eq(affiliates.id, programAffiliates.affiliateId))
    .where(eq(affiliates.userId, userId))
}

/**
 * Renames a named link. Only the label changes: the link's `code` is part of
 * every URL the affiliate has already shared, so it stays as it was.
 */
export async function renameReferralLink(userId: string, linkId: string, name: string): Promise<void> {
  await withUser(userId, async (tx) => {
    const updated = await tx
      .update(referralLinks)
      .set({ name: name.trim(), updatedAt: new Date() })
      .where(
        and(eq(referralLinks.id, linkId), inArray(referralLinks.programAffiliateId, ownParticipationIds(tx, userId))),
      )
      .returning({ id: referralLinks.id })
    if (updated.length === 0) throw new NotFoundError("Link not found.", "linkNotFound")
  })
}

/**
 * Deletes a named link. Its clicks stay recorded against the participation
 * (`referral_clicks.referral_link_id` is `on delete set null`), so earnings and
 * totals do not change — they are only no longer grouped under the link. A
 * shared URL keeps crediting the affiliate through its `ref` code.
 */
export async function deleteReferralLink(userId: string, linkId: string): Promise<void> {
  await withUser(userId, async (tx) => {
    const deleted = await tx
      .delete(referralLinks)
      .where(
        and(eq(referralLinks.id, linkId), inArray(referralLinks.programAffiliateId, ownParticipationIds(tx, userId))),
      )
      .returning({ id: referralLinks.id })
    if (deleted.length === 0) throw new NotFoundError("Link not found.", "linkNotFound")
  })
}
