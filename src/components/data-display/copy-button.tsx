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
}: {
  value: string
  /** Defaults to the translated "Copy". */
  label?: string
  className?: string
  size?: "sm" | "md"
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
      variant="secondary"
      size={size}
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
        <Check className="text-success-foreground" aria-hidden="true" />
      ) : (
        <Copy aria-hidden="true" />
      )}
      <span aria-live="polite">{copied ? t("copied") : (label ?? t("copy"))}</span>
    </Button>
  )
}

export function ReferralLinkField({ url, className }: { url: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-control border border-border bg-surface-2 p-1 pl-3",
        className,
      )}
    >
      <code className="min-w-0 flex-1 truncate font-mono text-meta text-foreground-secondary">
        {url}
      </code>
      <CopyButton value={url} />
    </div>
  )
}
