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
    >
      <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
    </NextThemes>
  )
}
