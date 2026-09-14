"use client"

import { ThemeProvider as NextThemes } from "next-themes"
import type * as React from "react"

import { TooltipProvider } from "@/components/ui/tooltip"

/**
 * `attribute="class"` matches the `.dark` selector the tokens are defined
 * against, and next-themes injects a blocking script so the correct theme is
 * applied before first paint — no flash. DESIGN.md §2.4 / spec §43.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemes
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      storageKey="indica-theme"
      // React 19 warns about a <script> rendered on the client ("Encountered
      // a script tag…"). The anti-flash script only matters in the server
      // HTML, where it runs during parsing; on the client it is inert either
      // way, so it is marked non-executable there to silence the warning.
      // The attribute mismatch is covered by next-themes' own
      // suppressHydrationWarning on that element.
      scriptProps={typeof window === "undefined" ? undefined : { type: "application/json" }}
    >
      <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
    </NextThemes>
  )
}
