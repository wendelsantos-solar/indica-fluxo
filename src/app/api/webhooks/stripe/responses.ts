import { NextResponse } from "next/server"

import type { IngestResult } from "@/server/services/billing-events"

/** One mapping from an ingest outcome to what Stripe sees, for every Stripe endpoint. */
export function ingestResponse(result: IngestResult): NextResponse {
  switch (result.status) {
    case "duplicate":
      return NextResponse.json({ received: true, duplicate: true })
    case "ignored":
      // A live event without live mode is not claimed, so it can be re-sent
      // from the Stripe dashboard once the plan is active again.
      return NextResponse.json({ received: true, ignored: result.reason ?? true })
    case "processed":
      return NextResponse.json({ received: true })
    case "failed":
      // 500 asks Stripe to retry; the claim row records why it failed.
      return NextResponse.json({ error: "processing_failed" }, { status: 500 })
  }
}
