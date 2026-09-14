import { useTranslations } from "next-intl"

import { ReferralLinkField } from "@/components/data-display/copy-button"
import { InlineAlert } from "@/components/feedback/inline-alert"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"
import { buildReferralUrl } from "@/lib/tracking/visitor"

/**
 * The participation's default referral link: the program's own site plus
 * `?ref=<code>`. The tracker only runs on that site, so a link to anywhere
 * else would never record a click (UI_UX_FUNCTIONAL_FINDINGS F10).
 *
 * Until the founder sets the site there is no default link to give — a guess
 * would be a broken link — so the affiliate is pointed at named links, whose
 * destination they choose.
 */
export function DefaultReferralLink({
  websiteUrl,
  code,
  prominent = false,
  linkToNamedLinks = false,
}: {
  websiteUrl: string | null
  code: string
  prominent?: boolean
  /** Offer a way to the Links page; off where the create form is already on screen. */
  linkToNamedLinks?: boolean
}) {
  const t = useTranslations("portal.defaultLink")

  if (websiteUrl) {
    return <ReferralLinkField url={buildReferralUrl(websiteUrl, code)} prominent={prominent} />
  }

  return (
    <InlineAlert
      title={t("missingTitle")}
      action={
        linkToNamedLinks ? (
          <Button asChild variant="secondary" size="sm" className="max-sm:h-11">
            <Link href="/affiliate/links">{t("createLink")}</Link>
          </Button>
        ) : undefined
      }
    >
      {t("missingDescription")}
    </InlineAlert>
  )
}
