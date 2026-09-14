"use client"

import { RotateCw } from "lucide-react"
import { useParams } from "next/navigation"
import { useTranslations } from "next-intl"

import { ErrorState } from "@/components/feedback/empty-state"
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
    <div className="py-8">
      <ErrorState
        title={t("title")}
        description={t("description")}
        action={
          <>
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
          </>
        }
      />
      {error.digest ? (
        <p className="text-center text-meta text-faint-foreground">
          {t("reference")} <span className="font-mono">{error.digest}</span>
        </p>
      ) : null}
    </div>
  )
}
