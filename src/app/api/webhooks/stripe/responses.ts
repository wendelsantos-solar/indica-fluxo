import { NextResponse } from "next/server"

import type { IngestResult } from "@/server/services/billing-events"

/** One mapping from an ingest outcome to what Stripe sees, for every Stripe endpoint. */
export function ingestResponse(result: IngestResult): NextResponse {
  switch (result.status) {
    case "duplicate":
      return NextResponse.json({ received: true, duplicate: true })
    case "ignored":
      return NextResponse.json({ received: true, ignored: true })
    case "processed":
      return NextResponse.json({ received: true })
    case "failed":
      // 500 asks Stripe to retry; the claim row records why it failed.
      return NextResponse.json({ error: "processing_failed" }, { status: 500 })
  }
}
