"use client"

import { CircleAlert } from "lucide-react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"

/**
 * Inside the portal shell, so the affiliate keeps their navigation. The server
 * message never reaches the page (production strips it anyway); the digest is
 * shown so a support conversation can find the log line.
 */
export default function AffiliatePortalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const t = useTranslations("portal.error")

  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center px-2 py-16 text-center md:py-24"
    >
      <div className="mb-4 flex size-10 items-center justify-center rounded-panel border border-danger/30 bg-surface-1 text-danger-foreground">
        <CircleAlert className="size-4.5" aria-hidden="true" />
      </div>
      <h1 className="text-ui font-medium text-foreground">{t("title")}</h1>
      <p className="mt-1.5 max-w-[46ch] text-pretty text-caption text-muted-foreground">
        {t("description")}
      </p>
      {error.digest ? (
        <p className="mt-2 font-mono text-meta text-faint-foreground">
          {t("digest", { digest: error.digest })}
        </p>
      ) : null}
      <div className="mt-6 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <Button variant="primary" className="max-sm:h-11" onClick={() => retry()}>
          {t("retry")}
        </Button>
        <Button asChild variant="secondary" className="max-sm:h-11">
          <Link href="/affiliate/overview">{t("back")}</Link>
        </Button>
      </div>
    </div>
  )
}
