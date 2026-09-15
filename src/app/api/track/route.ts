import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { TRACK_RATE_LIMIT } from "@/lib/api/contract"
import { peppered } from "@/lib/crypto/hash"
import { logger } from "@/lib/logger"
import { clientIp, rateLimit } from "@/lib/rate-limit"
import { VISITOR_COOKIE, VISITOR_COOKIE_MAX_AGE_DAYS } from "@/lib/tracking/constants"
import { isValidVisitorId, normalizeReferralCode } from "@/lib/tracking/visitor"
import { isAppError } from "@/server/policies/errors"
import { recordClick, workspaceForPublishableKey } from "@/server/services/tracking"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Route Handler contract (ARCHITECTURE.md §1): parse → validate → authenticate
 * → service → respond. No business logic lives here.
 */
const bodySchema = z.object({
  publicKey: z.string().min(8).max(128),
  ref: z.string().min(2).max(64),
  visitorId: z.string().min(4).max(64),
  url: z.string().url().max(2000),
  referrer: z.string().max(2000).nullish(),
  utm: z
    .object({
      utm_source: z.string().max(200).nullish(),
      utm_medium: z.string().max(200).nullish(),
      utm_campaign: z.string().max(200).nullish(),
      utm_content: z.string().max(200).nullish(),
      utm_term: z.string().max(200).nullish(),
    })
    .partial()
    .optional(),
})

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function POST(request: NextRequest) {
  const ip = clientIp(request.headers)

  const limit = rateLimit(`track:${ip}`, { limit: TRACK_RATE_LIMIT, windowSeconds: 60 })
  if (!limit.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { ...CORS, "retry-after": String(limit.retryAfterSeconds) } },
    )
  }

  let parsed: z.infer<typeof bodySchema>
  try {
    parsed = bodySchema.parse(await request.json())
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400, headers: CORS })
  }

  const code = normalizeReferralCode(parsed.ref)
  if (!code) {
    return NextResponse.json({ error: "invalid_ref" }, { status: 400, headers: CORS })
  }

  if (!isValidVisitorId(parsed.visitorId)) {
    return NextResponse.json({ error: "invalid_visitor" }, { status: 400, headers: CORS })
  }

  // The publishable key is looked up by hash; it is never logged or echoed.
  const workspaceId = await workspaceForPublishableKey(peppered(parsed.publicKey))
  if (!workspaceId) {
    return NextResponse.json({ error: "unknown_key" }, { status: 401, headers: CORS })
  }

  try {
    const result = await recordClick({
      workspaceId,
      code,
      visitorId: parsed.visitorId,
      landingUrl: parsed.url,
      referrerUrl: parsed.referrer ?? null,
      utm: parsed.utm,
      userAgent: request.headers.get("user-agent"),
      ip,
      country: request.headers.get("x-vercel-ip-country"),
    })

    const response = NextResponse.json(
      { ok: true, attributed: result.attributionAction !== "ignore" },
      { headers: CORS },
    )

    // First-party cookie so the visitor id survives across pages on the
    // customer's own domain when they proxy this endpoint.
    response.cookies.set(VISITOR_COOKIE, parsed.visitorId, {
      maxAge: VISITOR_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    })

    return response
  } catch (error) {
    if (isAppError(error)) {
      return NextResponse.json({ error: error.code }, { status: error.status, headers: CORS })
    }
    logger.error("track failed", { workspaceId, error })
    return NextResponse.json({ error: "internal_error" }, { status: 500, headers: CORS })
  }
}
