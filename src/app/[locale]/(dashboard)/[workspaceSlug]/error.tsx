"use client"

import { CircleAlert, RotateCw } from "lucide-react"
import { useParams } from "next/navigation"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"

/**
 * A page inside the workspace failed to render. The shell (layout) stays in
 * place, so the founder can navigate away; this offers a retry and the way
 * back to the overview. Nothing is logged here: the server already has the
 * error, and the message forwarded to the browser may carry details that do
 * not belong on screen. Only the opaque digest is shown, for support.
 */
export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const t = useTranslations("dashboard.error")
  const params = useParams<{ workspaceSlug?: string }>()
  const workspaceSlug = params.workspaceSlug

  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center px-6 py-16 text-center md:py-24"
    >
      <div className="mb-4 flex size-10 items-center justify-center rounded-panel border border-danger/30 bg-surface-1 text-danger-foreground">
        <CircleAlert className="size-4.5" aria-hidden="true" />
      </div>
      {/* The page's own header never rendered, so this is the page's heading. */}
      <h1 className="text-ui font-medium text-foreground">{t("title")}</h1>
      <p className="mt-1.5 max-w-[46ch] text-pretty text-caption text-muted-foreground">
        {t("description")}
      </p>
      {error.digest ? (
        <p className="mt-2 text-meta text-faint-foreground">
          {t("reference")} <span className="font-mono">{error.digest}</span>
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button type="button" variant="primary" onClick={() => retry()}>
          <RotateCw aria-hidden="true" />
          {t("retry")}
        </Button>
        {workspaceSlug ? (
          <Button asChild variant="secondary">
            <Link href={{ pathname: "/[workspaceSlug]/overview", params: { workspaceSlug } }}>
              {t("backToOverview")}
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  )
}
