/**
 * Route patterns for `revalidatePath`. Every page is locale-prefixed and its
 * pathname translated, so a literal like `/acme/programs` matches no route and
 * silently revalidates nothing. Revalidating the dashboard layout refreshes
 * every founder page for all locales and workspaces — mutations are rare and
 * one change (a new program, a connected Stripe) shows up on several pages,
 * including the overview's activation checklist.
 */
export const DASHBOARD_LAYOUT = "/[locale]/(dashboard)/[workspaceSlug]"
export const AFFILIATE_LAYOUT = "/[locale]/(affiliate)/affiliate"
