import { getTranslations } from "next-intl/server"

import { Link } from "@/i18n/navigation"
import { LEGAL } from "@/lib/legal/config"
import { cn } from "@/lib/utils"

/**
 * Terms · Privacy · Cookies (· Support once an address exists) — the same
 * short row in every public frame: marketing, docs and auth.
 */
export async function LegalLinks({ className, linkClassName }: { className?: string; linkClassName?: string }) {
  const t = await getTranslations("legal.links")
  const link = cn("transition-colors duration-[120ms] hover:text-foreground", linkClassName)
  return (
    <nav aria-label={t("label")} className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}>
      <Link href="/terms" className={link}>
        {t("terms")}
      </Link>
      <Link href="/privacy" className={link}>
        {t("privacy")}
      </Link>
      <Link href="/cookies" className={link}>
        {t("cookies")}
      </Link>
      {LEGAL.supportEmail ? (
        <a href={`mailto:${LEGAL.supportEmail}`} className={link}>
          {t("support")}
        </a>
      ) : null}
    </nav>
  )
}
