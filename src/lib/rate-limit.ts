import "server-only"

/**
 * In-process token bucket. Deliberately not Redis: V1 runs as a single
 * deployment and an extra piece of infrastructure is not justified yet.
 * The interface is storage-agnostic, so swapping in a shared store later does
 * not touch any caller.
 */

interface Bucket {
  tokens: number
  updatedAt: number
}

const buckets = new Map<string, Bucket>()
const MAX_TRACKED_KEYS = 20_000

export interface RateLimitResult {
  ok: boolean
  remaining: number
  retryAfterSeconds: number
}

export function rateLimit(
  key: string,
  { limit, windowSeconds }: { limit: number; windowSeconds: number },
): RateLimitResult {
  const now = Date.now()
  const refillRate = limit / (windowSeconds * 1000)

  let bucket = buckets.get(key)
  if (!bucket) {
    // Crude bound on memory: drop the whole map rather than leak unboundedly.
    if (buckets.size >= MAX_TRACKED_KEYS) buckets.clear()
    bucket = { tokens: limit, updatedAt: now }
    buckets.set(key, bucket)
  }

  bucket.tokens = Math.min(limit, bucket.tokens + (now - bucket.updatedAt) * refillRate)
  bucket.updatedAt = now

  if (bucket.tokens < 1) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / refillRate / 1000)),
    }
  }

  bucket.tokens -= 1
  return { ok: true, remaining: Math.floor(bucket.tokens), retryAfterSeconds: 0 }
}

/** Best-effort client address from proxy headers. Used only for hashing. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0]!.trim()
  return headers.get("x-real-ip") ?? "0.0.0.0"
}
