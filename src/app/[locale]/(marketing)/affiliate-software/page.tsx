import type { Metadata } from "next"
import { setRequestLocale } from "next-intl/server"

import type { Locale } from "@/i18n/routing"
import { ContentPageView, contentPageMetadata } from "@/features/marketing/content-page"

export async function generateMetadata({ params }: PageProps<"/[locale]/affiliate-software">): Promise<Metadata> {
  const { locale } = await params
  return contentPageMetadata("affiliateSoftware", locale as Locale)
}

export default async function AffiliateSoftwarePage({ params }: PageProps<"/[locale]/affiliate-software">) {
  const { locale } = await params
  setRequestLocale(locale)
  return <ContentPageView pageKey="affiliateSoftware" locale={locale as Locale} />
}
