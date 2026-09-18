import type { Metadata } from "next"
import { setRequestLocale } from "next-intl/server"

import type { Locale } from "@/i18n/routing"
import { ContentPageView, contentPageMetadata } from "@/features/marketing/content-page"

export async function generateMetadata({ params }: PageProps<"/[locale]/saas-affiliate-program">): Promise<Metadata> {
  const { locale } = await params
  return contentPageMetadata("saasAffiliateProgram", locale as Locale)
}

export default async function SaasAffiliateProgramPage({ params }: PageProps<"/[locale]/saas-affiliate-program">) {
  const { locale } = await params
  setRequestLocale(locale)
  return <ContentPageView pageKey="saasAffiliateProgram" locale={locale as Locale} />
}
