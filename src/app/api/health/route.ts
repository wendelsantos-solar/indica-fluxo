import { sql } from "drizzle-orm"
import { NextResponse } from "next/server"

import { db } from "@/server/db"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    await db.execute(sql`select 1`)
    return NextResponse.json({ status: "ok", database: "reachable" })
  } catch {
    return NextResponse.json({ status: "degraded", database: "unreachable" }, { status: 503 })
  }
}
