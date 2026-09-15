"use client"

import { Compass } from "lucide-react"
import { useParams } from "next/navigation"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"

/**
 * A record inside the workspace does not exist (or is not visible to this
 * member) — rendered inside the shell, so the sidebar is still there.
 * A client component only to read the workspace slug for the way back.
 */
export default function WorkspaceNotFound() {
  const t = useTranslations("dashboard.notFound")
  const params = useParams<{ workspaceSlug?: string }>()
  const workspaceSlug = params.workspaceSlug

  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center md:py-24">
      <div className="mb-4 flex size-10 items-center justify-center rounded-panel border border-border bg-surface-1 text-muted-foreground">
        <Compass className="size-4.5" aria-hidden="true" />
      </div>
      {/* No page header rendered for a missing record: this is the heading. */}
      <h1 className="text-ui font-medium text-foreground">{t("title")}</h1>
      <p className="mt-1.5 max-w-[46ch] text-pretty text-caption text-muted-foreground">
        {t("description")}
      </p>
      {workspaceSlug ? (
        <div className="mt-5 flex gap-2">
          <Button asChild variant="primary">
            <Link href={{ pathname: "/[workspaceSlug]/overview", params: { workspaceSlug } }}>
              {t("backToOverview")}
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  )
}
