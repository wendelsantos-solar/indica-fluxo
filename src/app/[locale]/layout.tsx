import type { Metadata } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
import { hasLocale, NextIntlClientProvider } from "next-intl"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { notFound } from "next/navigation"

import { ThemeProvider } from "@/components/layout/theme-provider"
import { Toaster } from "@/components/feedback/toaster"
import { BCP47, routing, type Locale } from "@/i18n/routing"

import "../globals.css"

/**
 * Inter Variable. `opsz` is requested explicitly so `font-variation-settings:
 * "opsz" 32` in theme.css has an axis to act on — without it the browser gets
 * a static instance and the optical sizing silently does nothing.
 *
 * `latin-ext` carries the accented glyphs Portuguese needs (ã, ç, õ, ê).
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
  axes: ["opsz"],
  display: "swap",
})

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin", "latin-ext"],
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
    title: { default: t("title"), template: t("titleTemplate") },
    description: t("description"),
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
        <NextIntlClientProvider>
          <ThemeProvider>
            {children}
            <Toaster />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
