import { getTranslations } from "next-intl/server"

import { routing } from "@/i18n/routing"
import { socialCard, SOCIAL_CARD_SIZE } from "@/components/seo/social-card"
import { BRAND } from "@/lib/brand"

export const alt = BRAND.name
export const size = SOCIAL_CARD_SIZE
export const contentType = "image/png"

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export default async function OpengraphImage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "seo.pages.stripeAffiliates" })
  const home = await getTranslations({ locale, namespace: "marketing.home.trust" })
  return socialCard({ eyebrow: t("eyebrow"), headline: t("title"), footer: `${home("noFee")} · ${home("stripe")}` })
}
