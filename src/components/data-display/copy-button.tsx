"use client"

import { Check, Copy } from "lucide-react"
import { useTranslations } from "next-intl"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

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
}: {
  value: string
  /** Defaults to the translated "Copy". */
  label?: string
  className?: string
  size?: "sm" | "md" | "lg"
  /** `primary` only when copying is the one thing the view exists for. */
  variant?: "primary" | "secondary" | "ghost"
  /** Id of the element holding the value, so "Copy" is announced with context. */
  describedBy?: string
}) {
  const t = useTranslations("common.actions")
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      aria-describedby={describedBy}
      className={cn("shrink-0", className)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
        } catch {
          setCopied(false)
        }
      }}
    >
      {copied ? (
        <Check
          className={variant === "primary" ? undefined : "text-success-foreground"}
          aria-hidden="true"
        />
      ) : (
        <Copy aria-hidden="true" />
      )}
      <span aria-live="polite">{copied ? t("copied") : (label ?? t("copy"))}</span>
    </Button>
  )
}

/**
 * A referral URL and its copy button — the one thing an affiliate comes back
 * for. On a phone the URL wraps in full above a full-width 44px button, so it
 * can be read and tapped with a thumb; from `sm` up it collapses to one row.
 */
export function ReferralLinkField({
  url,
  prominent = false,
  className,
}: {
  url: string
  /** Amber copy button. At most one per view. */
  prominent?: boolean
  className?: string
}) {
  const id = React.useId()

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
