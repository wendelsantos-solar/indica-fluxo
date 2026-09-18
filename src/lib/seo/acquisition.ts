import { z } from "zod"

import { UTM_PARAMS } from "@/lib/tracking/constants"

/**
 * First-touch acquisition: where a founder came from the first time they
 * reached the public site, kept until they create a workspace, then stored on
 * it (`workspaces.acquisition`). Joined to milestones the database already
 * records (program, simulated conversion, first click, first live commission,
 * paid plan), it answers the question SEO_STRATEGY.md §7 cares about —
 * organic search → landing page → activation → paid — not pageviews.
 *
 * Captured in the proxy from the request itself (URL + `Referer`), so it needs
 * no client script and the UTM parameters are read before anything could strip
 * them. Pure and runtime-agnostic: the proxy and the server action share it.
 *
 * Privacy: first-party, no identifier, no full referrer URL — only the
 * referring host — and no personal data (DATABASE.md §7).
 */

/** `Sec-GPC: 1` or `DNT: 1`: the visitor's browser declines measurement. */
export function optedOutOfMeasurement(headers: Headers): boolean {
  return headers.get("sec-gpc") === "1" || headers.get("dnt") === "1"
}

export const ACQUISITION_COOKIE = "_acq"
export const ACQUISITION_MAX_AGE_DAYS = 90

export const ACQUISITION_CHANNELS = [
  "organic_search",
  "paid",
  "social",
  "email",
  "referral",
  "campaign",
  "direct",
] as const

export type AcquisitionChannel = (typeof ACQUISITION_CHANNELS)[number]

const short = z.string().trim().min(1).max(100)

export const acquisitionSchema = z.object({
  v: z.literal(1),
  channel: z.enum(ACQUISITION_CHANNELS),
  /** Localised pathname of the first page seen, without query or hash. */
  landing: z.string().startsWith("/").max(200),
  locale: z.string().max(8).nullable(),
  /** Referring host only (`www.google.com`), never the full URL. */
  referrer: short.nullable(),
  utm: z.object({
    source: short.optional(),
    medium: short.optional(),
    campaign: short.optional(),
    content: short.optional(),
    term: short.optional(),
  }),
  at: z.string().datetime(),
})

export type Acquisition = z.infer<typeof acquisitionSchema>

/** Hosts whose referral means someone searched. Matched on the registrable label. */
const SEARCH_ENGINES = [/(^|\.)google\.[a-z.]+$/, /(^|\.)bing\.com$/, /(^|\.)duckduckgo\.com$/, /(^|\.)search\.yahoo\.com$/, /(^|\.)yandex\.[a-z.]+$/, /(^|\.)ecosia\.org$/, /(^|\.)baidu\.com$/, /(^|\.)search\.brave\.com$/, /(^|\.)qwant\.com$/]

const SOCIAL = [/(^|\.)t\.co$/, /(^|\.)x\.com$/, /(^|\.)twitter\.com$/, /(^|\.)linkedin\.com$/, /(^|\.)lnkd\.in$/, /(^|\.)facebook\.com$/, /(^|\.)instagram\.com$/, /(^|\.)youtube\.com$/, /(^|\.)reddit\.com$/, /(^|\.)news\.ycombinator\.com$/, /(^|\.)threads\.net$/, /(^|\.)bsky\.app$/]

const PAID_MEDIUMS = new Set(["cpc", "ppc", "paid", "paidsearch", "paid_search", "paid-social", "paid_social", "display", "cpm", "cpa"])
const EMAIL_MEDIUMS = new Set(["email", "e-mail", "newsletter"])
const SOCIAL_MEDIUMS = new Set(["social", "social-media", "social_media", "sm"])

export function classifyChannel({
  referrerHost,
  ownHosts,
  utmMedium,
  hasUtm,
  hasAdClickId,
}: {
  referrerHost: string | null
  /** The site's own hosts: a referral from one of them is navigation, not a source. */
  ownHosts: readonly string[]
  utmMedium?: string
  hasUtm: boolean
  hasAdClickId: boolean
}): AcquisitionChannel {
  const medium = utmMedium?.toLowerCase()
  if (hasAdClickId || (medium && PAID_MEDIUMS.has(medium))) return "paid"
  if (medium && EMAIL_MEDIUMS.has(medium)) return "email"
  if (medium && SOCIAL_MEDIUMS.has(medium)) return "social"
  if (medium === "organic") return "organic_search"
  if (hasUtm) return "campaign"

  if (!referrerHost || ownHosts.includes(referrerHost)) return "direct"
  if (SEARCH_ENGINES.some((pattern) => pattern.test(referrerHost))) return "organic_search"
  if (SOCIAL.some((pattern) => pattern.test(referrerHost))) return "social"
  return "referral"
}

function referrerHostOf(referrer: string | null): string | null {
  if (!referrer) return null
  try {
    return new URL(referrer).hostname.toLowerCase() || null
  } catch {
    return null
  }
}

/** Reads the first touch off a document request. */
export function captureAcquisition({
  url,
  referrer,
  locales,
  ownHosts = [],
  now = new Date(),
}: {
  url: URL
  referrer: string | null
  locales: readonly string[]
  /** Hosts besides the request's own that count as this site (the public site and app origins). */
  ownHosts?: readonly string[]
  now?: Date
}): Acquisition {
  const utm: Acquisition["utm"] = {}
  for (const param of UTM_PARAMS) {
    const value = url.searchParams.get(param)?.trim().slice(0, 100)
    if (value) utm[param.slice(4) as keyof Acquisition["utm"]] = value
  }

  const referrerHost = referrerHostOf(referrer)
  const hosts = [url.hostname.toLowerCase(), ...ownHosts.map((host) => host.toLowerCase())]
  const firstSegment = url.pathname.split("/")[1] ?? ""

  return {
    v: 1,
    channel: classifyChannel({
      referrerHost,
      ownHosts: hosts,
      utmMedium: utm.medium,
      hasUtm: Object.keys(utm).length > 0,
      hasAdClickId: url.searchParams.has("gclid") || url.searchParams.has("msclkid"),
    }),
    landing: url.pathname.slice(0, 200),
    locale: locales.includes(firstSegment) ? firstSegment : null,
    // A same-site referrer is navigation inside the site, not a source.
    referrer: referrerHost && !hosts.includes(referrerHost) ? referrerHost.slice(0, 100) : null,
    utm,
    at: now.toISOString(),
  }
}

export function encodeAcquisition(value: Acquisition): string {
  return encodeURIComponent(JSON.stringify(value))
}

/** `null` for anything absent, tampered or from an older shape — a cookie is untrusted input. */
export function decodeAcquisition(raw: string | undefined | null): Acquisition | null {
  if (!raw) return null
  try {
    const parsed = acquisitionSchema.safeParse(JSON.parse(decodeURIComponent(raw)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
