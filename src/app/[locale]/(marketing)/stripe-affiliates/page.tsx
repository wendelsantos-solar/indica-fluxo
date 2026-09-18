import type { Metadata } from "next"
import { setRequestLocale } from "next-intl/server"

import type { Locale } from "@/i18n/routing"
import { ContentPageView, contentPageMetadata } from "@/features/marketing/content-page"

export async function generateMetadata({ params }: PageProps<"/[locale]/stripe-affiliates">): Promise<Metadata> {
  const { locale } = await params
  return contentPageMetadata("stripeAffiliates", locale as Locale)
}

export default async function StripeAffiliatesPage({ params }: PageProps<"/[locale]/stripe-affiliates">) {
  const { locale } = await params
  setRequestLocale(locale)
  return <ContentPageView pageKey="stripeAffiliates" locale={locale as Locale} />
}
