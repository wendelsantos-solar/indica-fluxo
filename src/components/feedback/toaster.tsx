"use client"

import { useTheme } from "next-themes"
import * as React from "react"
import { Toaster as Sonner } from "sonner"

/**
 * Toasts are reserved for asynchronous, off-screen outcomes — DESIGN.md §9.
 * A form that can show inline success must not fire one.
 */
export function Toaster() {
  const { resolvedTheme } = useTheme()
  const narrow = React.useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia("(max-width: 639px)")
      query.addEventListener("change", onChange)
      return () => query.removeEventListener("change", onChange)
    },
    () => window.matchMedia("(max-width: 639px)").matches,
    () => false,
  )

  return (
    <Sonner
      theme={resolvedTheme === "light" ? "light" : "dark"}
      position={narrow ? "bottom-center" : "bottom-right"}
      duration={4000}
      // Sonner's own default is 999999999; the product's scale keeps toasts
      // above dialogs and popovers without outranking the skip link.
      style={{ zIndex: "var(--z-index-toast)" }}
      toastOptions={{
        classNames: {
          toast:
            "!bg-surface-3 !border-border !text-foreground !rounded-panel !shadow-overlay !text-caption",
          description: "!text-muted-foreground",
          actionButton: "!bg-primary !text-primary-foreground",
        },
      }}
    />
  )
}
