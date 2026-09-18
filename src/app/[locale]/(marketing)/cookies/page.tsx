import type { Metadata } from "next"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { CookieTable } from "@/features/legal/cookie-table"
import { LegalDocument } from "@/features/legal/legal-document"
import type { Locale } from "@/i18n/routing"
import { pageMetadata } from "@/lib/seo/metadata"

export async function generateMetadata({ params }: PageProps<"/[locale]/cookies">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "legal.cookies" })
  return pageMetadata({ href: "/cookies", locale: locale as Locale, title: t("metaTitle"), description: t("metaDescription") })
}

export default async function CookiesPage({ params }: PageProps<"/[locale]/cookies">) {
  const { locale } = await params
  setRequestLocale(locale)
  return <LegalDocument doc="cookies" slots={{ site: <CookieTable where="site" />, customerSite: <CookieTable where="customerSite" /> }} />
}
