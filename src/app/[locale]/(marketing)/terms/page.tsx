import type { Metadata } from "next"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { LegalDocument } from "@/features/legal/legal-document"
import type { Locale } from "@/i18n/routing"
import { pageMetadata } from "@/lib/seo/metadata"

export async function generateMetadata({ params }: PageProps<"/[locale]/terms">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "legal.terms" })
  return pageMetadata({ href: "/terms", locale: locale as Locale, title: t("metaTitle"), description: t("metaDescription") })
}

export default async function TermsPage({ params }: PageProps<"/[locale]/terms">) {
  const { locale } = await params
  setRequestLocale(locale)
  return <LegalDocument doc="terms" />
}
