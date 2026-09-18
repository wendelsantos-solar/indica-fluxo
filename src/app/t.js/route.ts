import { NextResponse } from "next/server"

import { appUrl } from "@/lib/site"
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
 *
 * Not `immutable`: the URL carries no version, so a tracker fix must reach
 * sites that already embed it once the cache expires.
 */
export function GET() {
  return new NextResponse(trackerSource(new URL(TRACK_API_PATH, appUrl()).toString()), {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400",
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
    },
  })
}
