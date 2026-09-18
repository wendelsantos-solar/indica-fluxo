import type { Metadata } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
import { hasLocale, NextIntlClientProvider } from "next-intl"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { notFound } from "next/navigation"

import { ThemeProvider } from "@/components/layout/theme-provider"
import { Toaster } from "@/components/feedback/toaster"
import { clientMessages } from "@/i18n/client-messages"
import { BCP47, routing, type Locale } from "@/i18n/routing"
import { BRAND } from "@/lib/brand"
import { siteUrl } from "@/lib/site"

import "../globals.css"

/**
 * Inter Variable. `opsz` is requested explicitly so `font-variation-settings:
 * "opsz" 32` in theme.css has an axis to act on — without it the browser gets
 * a static instance and the optical sizing silently does nothing.
 *
 * `subsets` decides only what is PRELOADED: every subset is self-hosted with a
 * `unicode-range`, so a glyph outside `latin` still loads when a page uses it.
 * Portuguese's accents (ã, ç, õ, ê) are Latin-1, inside `latin`; preloading
 * `latin-ext` too cost 88 KB of font on every first visit (PERFORMANCE_AUDIT.md).
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
})

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
})

/** Pre-renders both locales at build time instead of on first request. */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export async function generateMetadata({
  params,
}: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "meta" })

  return {
    metadataBase: siteUrl(),
    applicationName: BRAND.name,
    title: { default: t("title"), template: t("titleTemplate") },
    description: t("description"),
    // Private by default: sign-in, the dashboard, the affiliate portal,
    // onboarding and every 404 inherit this. Only pages registered in
    // src/lib/seo/pages.ts override it, through `pageMetadata()`.
    robots: { index: false, follow: false },
  }
}

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) notFound()

  // Opts this subtree into static rendering; without it every page under a
  // locale is forced dynamic the moment it reads a translation.
  setRequestLocale(locale)

  return (
    <html
      lang={BCP47[locale as Locale]}
      className={`${inter.variable} ${jetbrainsMono.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        {/* Only what this level's client components read; each route group's
            layout passes its own scope (src/i18n/client-namespaces.ts). */}
        <NextIntlClientProvider messages={await clientMessages("root")}>
          <ThemeProvider>
            {children}
            <Toaster />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
