import { UTM_PARAMS, type UtmParam } from "./constants"

/**
 * Pure helpers shared by the browser tracker and the ingest endpoint.
 * No DOM, no Node, no React — this module must stay portable enough to run in
 * an edge worker if `/api/track` is ever lifted out. See ARCHITECTURE.md §3.1.
 */

/** 128 bits of randomness, URL-safe, no dependency on crypto.randomUUID. */
export function generateVisitorId(random: () => number = Math.random): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
  let out = "v_"
  for (let i = 0; i < 24; i += 1) {
    out += alphabet[Math.floor(random() * alphabet.length)]
  }
  return out
}

export function isValidVisitorId(value: string | null | undefined): value is string {
  return typeof value === "string" && /^v_[a-z0-9]{16,48}$/.test(value)
}

export function normalizeReferralCode(value: string | null | undefined): string | null {
  if (!value) return null
  const code = value.trim().toLowerCase()
  return /^[a-z0-9][a-z0-9_-]{1,48}$/.test(code) ? code : null
}

export function extractUtm(params: URLSearchParams): Partial<Record<UtmParam, string>> {
  const out: Partial<Record<UtmParam, string>> = {}
  for (const key of UTM_PARAMS) {
    const value = params.get(key)
    if (value) out[key] = value.slice(0, 200)
  }
  return out
}

export type DeviceType = "desktop" | "mobile" | "tablet" | "unknown"

/**
 * Coarse bucketing only. We deliberately never persist the user agent string:
 * the device class is enough for reporting and carries far less fingerprint.
 */
export function classifyDevice(userAgent: string | null | undefined): DeviceType {
  if (!userAgent) return "unknown"
  const ua = userAgent.toLowerCase()
  if (/ipad|tablet|playbook|silk/.test(ua)) return "tablet"
  if (/mobi|iphone|android.+mobile|phone/.test(ua)) return "mobile"
  if (/mozilla|chrome|safari|firefox|edge/.test(ua)) return "desktop"
  return "unknown"
}

/** Strips credentials, fragments and overlong query strings before storage. */
export function sanitizeUrl(raw: string | null | undefined, maxLength = 1000): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (!["http:", "https:"].includes(url.protocol)) return null
    url.username = ""
    url.password = ""
    url.hash = ""
    return url.toString().slice(0, maxLength)
  } catch {
    return null
  }
}

export function buildReferralUrl(destination: string, code: string, param = "ref"): string {
  try {
    const url = new URL(destination)
    url.searchParams.set(param, code)
    return url.toString()
  } catch {
    return `${destination}?${param}=${encodeURIComponent(code)}`
  }
}
