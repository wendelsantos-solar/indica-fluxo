import { setRequestLocale } from "next-intl/server"

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
    <div className="flex min-h-dvh flex-col bg-background">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  )
}
