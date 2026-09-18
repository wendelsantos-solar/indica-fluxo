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

/**
 * A page that sets its own `openGraph` replaces its parent's, image included,
 * so every indexable page ships a card of its own.
 */
export default async function OpengraphImage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "pricing" })
  const home = await getTranslations({ locale, namespace: "marketing.home.trust" })
  return socialCard({ eyebrow: t("metaTitle"), headline: t("title"), footer: `${home("noCard")} · ${home("noFee")}` })
}
