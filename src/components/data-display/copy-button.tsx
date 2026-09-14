"use client"

import { Check, Copy } from "lucide-react"
import { useTranslations } from "next-intl"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Copies with the Clipboard API, and falls back to selecting the value and
 * `execCommand("copy")` where that API is missing — an insecure origin, such as
 * a phone opening the dev server by LAN address, or an older in-app browser.
 */
async function copyText(value: string, sourceId?: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // Permission denied or not focused: try the selection fallback below.
  }

  const source = sourceId ? document.getElementById(sourceId) : null
  const selection = window.getSelection()
  if (!source || !selection) return false

  const range = document.createRange()
  range.selectNodeContents(source)
  selection.removeAllRanges()
  selection.addRange(range)

  try {
    // Deprecated but still the only path without the Clipboard API. If it
    // fails, the value stays selected so the reader can copy it by hand.
    return document.execCommand("copy")
  } catch {
    return false
  }
}

/**
 * Inline feedback rather than a toast: the outcome is visible where the action
 * happened, which DESIGN.md §9 prefers.
 */
export function CopyButton({
  value,
  label,
  className,
  size = "sm",
  variant = "secondary",
  describedBy,
  iconOnly = false,
}: {
  value: string
  /** Defaults to the translated "Copy". With `iconOnly`, the accessible name. */
  label?: string
  className?: string
  size?: "sm" | "md" | "lg" | "icon"
  /** `primary` only when copying is the one thing the view exists for. */
  variant?: "primary" | "secondary" | "ghost"
  /** Id of the element holding the value, so "Copy" is announced with context. */
  describedBy?: string
  /** A square button; the label becomes its accessible name. */
  iconOnly?: boolean
}) {
  const t = useTranslations("common.actions")
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(timer)
  }, [copied])

  const text = copied ? t("copied") : (label ?? t("copy"))

  return (
    <Button
      type="button"
      variant={variant}
      size={iconOnly ? "icon" : size}
      aria-describedby={describedBy}
      aria-label={iconOnly ? (label ?? t("copy")) : undefined}
      className={cn("shrink-0", className)}
      onClick={async () => setCopied(await copyText(value, describedBy))}
    >
      {copied ? (
        <Check
          className={variant === "primary" ? undefined : "text-success-foreground"}
          aria-hidden="true"
        />
      ) : (
        <Copy aria-hidden="true" />
      )}
      <span aria-live="polite" className={iconOnly ? "sr-only" : undefined}>
        {iconOnly ? (copied ? t("copied") : "") : text}
      </span>
    </Button>
  )
}

/**
 * A referral URL and its copy button — the one thing an affiliate comes back
 * for. On a phone the URL wraps in full above a full-width 44px button, so it
 * can be read and tapped with a thumb; from `sm` up it collapses to one row.
 *
 * `compact` is for a list of links: the URL still wraps in full (the `ref` and
 * `link` parameters at its end are the part that matters), beside a square
 * copy button that stays 44px on a phone.
 */
export function ReferralLinkField({
  url,
  prominent = false,
  compact = false,
  copyLabel,
  className,
}: {
  url: string
  /** Amber copy button. At most one per view. */
  prominent?: boolean
  compact?: boolean
  /** Accessible name of the compact copy button, when several links share a view. */
  copyLabel?: string
  className?: string
}) {
  const id = React.useId()

  if (compact) {
    return (
      <div className={cn("flex items-start gap-2", className)}>
        <code
          id={id}
          className={cn(
            "flex min-h-11 min-w-0 flex-1 select-all items-center rounded-control border border-border bg-fill-subtle px-2.5 py-2",
            "break-all font-mono text-meta text-foreground-secondary",
            "sm:min-h-8 sm:py-1.5",
          )}
        >
          <span className="min-w-0">{url}</span>
        </code>
        <CopyButton
          value={url}
          iconOnly
          label={copyLabel}
          variant={prominent ? "primary" : "secondary"}
          describedBy={id}
          className="size-11 sm:size-8"
        />
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-center", className)}>
      <code
        id={id}
        className={cn(
          "flex min-h-11 min-w-0 flex-1 select-all items-center rounded-control border border-border bg-fill-subtle px-3 py-2",
          "break-all font-mono text-meta text-foreground-secondary",
          "sm:min-h-8 sm:py-1.5",
        )}
      >
        <span className="min-w-0 sm:truncate">{url}</span>
      </code>
      <CopyButton
        value={url}
        size="lg"
        variant={prominent ? "primary" : "secondary"}
        describedBy={id}
        className="h-11 w-full sm:h-8 sm:w-auto"
      />
    </div>
  )
}
