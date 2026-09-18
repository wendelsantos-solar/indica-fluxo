import { STRIPE_OAUTH_STATE_COOKIE_NAME } from "./cookie-names"

/**
 * Every cookie (and browser storage key) the product sets — one list for the
 * cookie policy page and COOKIE_AUDIT.md, pinned by a test against the
 * constants in code so a new cookie cannot ship unlisted.
 *
 * `site`: set on the product's own domain. `customerSite`: set by the tracker
 * (`/t.js`) on a founder's own website, on the founder's behalf.
 */
export type CookieCategory = "necessary" | "functional" | "measurement"

export interface CookieEntry {
  name: string
  where: "site" | "customerSite"
  category: CookieCategory
  /** Key under `legal.cookies.purposes` / `legal.cookies.durations`. */
  purpose: string
  duration: string
  storage: "cookie" | "localStorage"
}

export const COOKIES: readonly CookieEntry[] = [
  { name: "sb-<projeto>-auth-token", where: "site", category: "necessary", purpose: "session", duration: "session", storage: "cookie" },
  { name: "NEXT_LOCALE", where: "site", category: "functional", purpose: "locale", duration: "year", storage: "cookie" },
  { name: "indica_last_workspace", where: "site", category: "functional", purpose: "lastWorkspace", duration: "year", storage: "cookie" },
  { name: STRIPE_OAUTH_STATE_COOKIE_NAME, where: "site", category: "necessary", purpose: "oauthState", duration: "tenMinutes", storage: "cookie" },
  { name: "_acq", where: "site", category: "measurement", purpose: "acquisition", duration: "ninetyDays", storage: "cookie" },
  { name: "indica-theme", where: "site", category: "functional", purpose: "theme", duration: "untilCleared", storage: "localStorage" },
  { name: "indica.sidebar.collapsed", where: "site", category: "functional", purpose: "sidebar", duration: "untilCleared", storage: "localStorage" },
  { name: "_referral_id", where: "customerSite", category: "necessary", purpose: "visitor", duration: "year", storage: "cookie" },
  { name: "_referral_ref", where: "customerSite", category: "necessary", purpose: "reference", duration: "year", storage: "cookie" },
]
