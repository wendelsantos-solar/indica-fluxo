import { NextResponse } from "next/server"

import { trackerSource } from "@/lib/tracking/script"

export const dynamic = "force-static"
export const revalidate = 3600

/**
 * The public tracker. Deliberately a static asset with permissive CORS: it is
 * meant to be embedded on the customer's own marketing site.
 */
export function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

  return new NextResponse(trackerSource(`${appUrl}/api/track`), {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400, immutable",
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
    },
  })
}
