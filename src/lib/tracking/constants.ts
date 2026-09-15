/** Shared between the browser tracker and the server. Framework-free. */

export const VISITOR_COOKIE = "_referral_id"
export const REF_QUERY_PARAMS = ["ref", "via", "aff"] as const
export const VISITOR_COOKIE_MAX_AGE_DAYS = 365
export const TRACKER_PATH = "/t.js"
/** Where the tracker posts clicks, relative to the host that served it. */
export const TRACK_API_PATH = "/api/track"

export const UTM_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const

export type UtmParam = (typeof UTM_PARAMS)[number]
