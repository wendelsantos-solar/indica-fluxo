"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner } from "sonner"

/**
 * Toasts are reserved for asynchronous, off-screen outcomes — DESIGN.md §9.
 * A form that can show inline success must not fire one.
 */
export function Toaster() {
  const { resolvedTheme } = useTheme()

  return (
    <Sonner
      theme={resolvedTheme === "light" ? "light" : "dark"}
      position="bottom-right"
      duration={4000}
      toastOptions={{
        classNames: {
          toast:
            "!bg-surface-3 !border-border !text-foreground !rounded-panel !shadow-[var(--shadow-overlay)] !text-caption",
          description: "!text-muted-foreground",
          actionButton: "!bg-primary !text-primary-foreground",
        },
      }}
    />
  )
}
