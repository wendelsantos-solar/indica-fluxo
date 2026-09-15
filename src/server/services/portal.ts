import "server-only"

import { eq } from "drizzle-orm"

import { withUser } from "@/server/db"
import { referralLinks } from "@/server/db/schema"
import { NotFoundError } from "@/server/policies/errors"

/**
 * An affiliate's own named links. `referral_links_owner_write` (migration 0001)
 * lets the owning affiliate — or an admin of the program's workspace — update
 * and delete a link; anyone else matches no row, which reads as "not found".
 */

/**
 * Renames a named link. Only the label changes: the link's `code` is part of
 * every URL the affiliate has already shared, so it stays as it was.
 */
export async function renameReferralLink(userId: string, linkId: string, name: string): Promise<void> {
  await withUser(userId, async (tx) => {
    const updated = await tx
      .update(referralLinks)
      .set({ name: name.trim(), updatedAt: new Date() })
      .where(eq(referralLinks.id, linkId))
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
      .where(eq(referralLinks.id, linkId))
      .returning({ id: referralLinks.id })
    if (deleted.length === 0) throw new NotFoundError("Link not found.", "linkNotFound")
  })
}
