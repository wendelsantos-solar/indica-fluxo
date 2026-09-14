import { cva, type VariantProps } from "class-variance-authority"
import { useTranslations } from "next-intl"
import * as React from "react"

import { cn } from "@/lib/utils"

/** DESIGN.md §9. Status vocabulary is fixed — never invent a new tone. */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-badge px-2 h-5 text-meta font-medium leading-none whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "bg-surface-2 text-muted-foreground border border-border",
        success: "bg-success-subtle text-success-foreground",
        warning: "bg-warning-subtle text-warning-foreground",
        danger: "bg-danger-subtle text-danger-foreground",
        info: "bg-info-subtle text-info-foreground",
        primary: "bg-primary/15 text-foreground",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}

const TONES = {
  active: "success",
  approved: "success",
  paid: "success",
  available: "success",
  connected: "success",
  succeeded: "success",
  pending: "warning",
  draft: "warning",
  invited: "warning",
  hold: "warning",
  reversed: "danger",
  rejected: "danger",
  cancelled: "danger",
  failed: "danger",
  suspended: "danger",
  chargeback: "danger",
  refund: "danger",
  paused: "neutral",
  archived: "neutral",
  inactive: "neutral",
  disconnected: "neutral",
} as const

export type KnownStatus = keyof typeof TONES

/**
 * Maps a domain status onto its tone and its label, so neither colour nor
 * wording is ad hoc. The label is a catalogue lookup rather than a capitalised
 * database value: "reversed" is a word a reader sees, and it has to be a word
 * in their language.
 */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const t = useTranslations("status")
  const tone = (TONES[status as KnownStatus] ?? "info") as NonNullable<BadgeProps["tone"]>
  const key = status.replace(/_/g, "")

  return (
    <Badge tone={tone} className={className}>
      {t.has(key) ? t(key) : status}
    </Badge>
  )
}
