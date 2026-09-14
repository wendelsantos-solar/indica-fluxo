import type { Metadata } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"

import { ThemeProvider } from "@/components/layout/theme-provider"
import { Toaster } from "@/components/feedback/toaster"

import "./globals.css"

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

export const metadata: Metadata = {
  title: {
    default: "Indica — referral infrastructure for SaaS",
    template: "%s · Indica",
  },
  description:
    "Track every click, conversion and recurring commission without building affiliate infrastructure yourself.",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
