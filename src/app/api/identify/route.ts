import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { IDENTIFY_RATE_LIMIT, identifyBodySchema } from "@/lib/api/contract"
import { logger } from "@/lib/logger"
import { clientIp, rateLimit } from "@/lib/rate-limit"
import { isValidVisitorId } from "@/lib/tracking/visitor"
import { isAppError } from "@/server/policies/errors"
import { authenticateApiKey } from "@/server/services/api-keys"
import { identifyCustomer } from "@/server/services/identify"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Server-to-server only. A browser-supplied customer id would let anyone
 * reassign commissions, so this endpoint accepts a SECRET key and nothing else
 * — and deliberately sends no CORS headers. See ARCHITECTURE.md §3.2.
 */
const bodySchema = identifyBodySchema

export async function POST(request: NextRequest) {
  const limit = rateLimit(`identify:${clientIp(request.headers)}`, {
    limit: IDENTIFY_RATE_LIMIT,
    windowSeconds: 60,
  })
  if (!limit.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    )
  }

  const header = request.headers.get("authorization")
  const presented = header?.startsWith("Bearer ") ? header.slice(7) : null
  if (!presented) {
    return NextResponse.json({ error: "missing_credentials" }, { status: 401 })
  }

  let parsed: z.infer<typeof bodySchema>
  try {
    parsed = bodySchema.parse(await request.json())
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 })
  }

  if (!isValidVisitorId(parsed.visitorId)) {
    return NextResponse.json({ error: "invalid_visitor" }, { status: 400 })
  }

  try {
    const key = await authenticateApiKey(presented, "secret")

    const result = await identifyCustomer({
      workspaceId: key.workspaceId,
      visitorId: parsed.visitorId,
      externalId: parsed.externalId,
      providerCustomerId: parsed.providerCustomerId ?? null,
      provider: parsed.provider,
      email: parsed.email ?? null,
    })

    return NextResponse.json({
      ok: true,
      customerId: result.customerId,
      attributionsBound: result.boundAttributions,
    })
  } catch (error) {
    if (isAppError(error)) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status })
    }
    logger.error("identify failed", { error })
    return NextResponse.json({ error: "internal_error" }, { status: 500 })
  }
}
