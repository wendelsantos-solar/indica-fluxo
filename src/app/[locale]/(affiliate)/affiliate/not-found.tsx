import { Compass } from "lucide-react"
import { useTranslations } from "next-intl"

import { EmptyState } from "@/components/feedback/empty-state"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"

/** A missing record inside the portal: stay in the shell, offer the way home. */
export default function AffiliatePortalNotFound() {
  const t = useTranslations("portal.notFound")

  return (
    <EmptyState
      icon={Compass}
      title={t("title")}
      description={t("description")}
      className="md:py-24"
      action={
        <Button asChild variant="secondary" className="max-sm:h-11">
          <Link href="/affiliate/overview">{t("back")}</Link>
        </Button>
      }
    />
  )
}
