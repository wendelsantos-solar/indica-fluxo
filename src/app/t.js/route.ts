import { NextResponse } from "next/server"

import { TRACK_API_PATH } from "@/lib/tracking/constants"
import { trackerSource } from "@/lib/tracking/script"

export const dynamic = "force-static"
export const revalidate = 3600

/**
 * The public tracker. Deliberately a static asset with permissive CORS: it is
 * meant to be embedded on the customer's own marketing site. The endpoint
 * baked in here is only a fallback: the script posts to the host it was
 * loaded from, so a static build made without `NEXT_PUBLIC_APP_URL` does not
 * freeze a localhost endpoint into production.
 */
export function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

  return new NextResponse(trackerSource(`${appUrl}${TRACK_API_PATH}`), {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400, immutable",
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
    },
  })
}
