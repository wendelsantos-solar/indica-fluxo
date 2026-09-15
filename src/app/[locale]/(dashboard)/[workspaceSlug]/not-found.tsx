"use client"

import { Compass } from "lucide-react"
import { useParams } from "next/navigation"
import { useTranslations } from "next-intl"

import { EmptyState } from "@/components/feedback/empty-state"
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
    <div className="py-8">
      <EmptyState
        icon={Compass}
        title={t("title")}
        description={t("description")}
        action={
          workspaceSlug ? (
            <Button asChild variant="primary">
              <Link href={{ pathname: "/[workspaceSlug]/overview", params: { workspaceSlug } }}>
                {t("backToOverview")}
              </Link>
            </Button>
          ) : undefined
        }
      />
    </div>
  )
}
