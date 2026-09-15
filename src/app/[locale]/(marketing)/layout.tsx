import { NextIntlClientProvider } from "next-intl"
import { setRequestLocale } from "next-intl/server"

import { clientMessages } from "@/i18n/client-messages"

import { SiteFooter } from "./_components/site-footer"
import { SiteHeader } from "./_components/site-header"

/**
 * The public frame: navbar, page, footer. No session is read here, so every
 * marketing page stays statically rendered.
 */
export default async function MarketingLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <NextIntlClientProvider messages={await clientMessages("marketing")}>
      <div className="flex min-h-dvh flex-col bg-background">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </div>
    </NextIntlClientProvider>
  )
}
