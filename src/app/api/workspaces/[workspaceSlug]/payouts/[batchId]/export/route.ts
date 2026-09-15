import { getTranslations } from "next-intl/server"
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { formatBatchLabel } from "@/features/payouts/batch-label"
import { buildPayoutCsv, csvFormatForLocale, payoutCsvFilename } from "@/features/payouts/csv"
import { routing } from "@/i18n/routing"
import { logger } from "@/lib/logger"
import { getSessionUser } from "@/server/auth/session"
import { isAppError } from "@/server/policies/errors"
import { getPayoutBatchExport } from "@/server/services/payouts"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * A payout batch as CSV: the list a founder sends the money from. Session
 * authenticated (the user's cookies, RLS via `withUser`), owners and admins
 * only — the service checks the role. Outside the locale segment like every
 * `app/api` route, so the reader's language arrives as `?locale=`.
 */
const inputSchema = z.object({
  workspaceSlug: z.string().min(1).max(64),
  batchId: z.uuid(),
  locale: z.enum(routing.locales).catch(routing.defaultLocale),
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceSlug: string; batchId: string }> },
) {
  const parsed = inputSchema.safeParse({ ...(await params), locale: request.nextUrl.searchParams.get("locale") })
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  const { workspaceSlug, batchId, locale } = parsed.data

  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  try {
    const workspace = await getWorkspaceForUser(user.id, workspaceSlug)
    const { batch, items } = await getPayoutBatchExport(user.id, workspace.id, batchId)

    const t = await getTranslations({ locale, namespace: "dashboard.batch.export" })
    const csv = buildPayoutCsv({
      columns: {
        affiliate: t("columns.affiliate"),
        email: t("columns.email"),
        amount: t("columns.amount"),
        currency: t("columns.currency"),
        commissions: t("columns.commissions"),
        batch: t("columns.batch"),
      },
      rows: items,
      batchLabel: formatBatchLabel(locale, batch.periodEnd, batch.reference),
      format: csvFormatForLocale(locale),
    })
    const filename = payoutCsvFilename({
      workspaceSlug,
      periodEnd: batch.periodEnd,
      reference: batch.reference,
      prefix: t("filenamePrefix"),
    })

    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    })
  } catch (error) {
    if (isAppError(error)) return NextResponse.json({ error: error.code }, { status: error.status })
    logger.error("payout export failed", { workspaceSlug, batchId, error: String(error) })
    return NextResponse.json({ error: "internal_error" }, { status: 500 })
  }
}
