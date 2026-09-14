import { cva, type VariantProps } from "class-variance-authority"
import { useTranslations } from "next-intl"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * DESIGN.md §9. A hairline chip with a coloured dot: the label carries the
 * meaning, the dot lets a column of statuses be scanned. The label stays
 * neutral text, so a table of badges never turns into a wall of colour.
 * Status vocabulary is fixed — never invent a new tone.
 */
const badgeVariants = cva(
  [
    "inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-badge border border-border px-1.5",
    "text-meta font-medium leading-none text-foreground-secondary",
  ].join(" "),
  {
    variants: {
      tone: {
        neutral: "",
        success: "",
        warning: "",
        danger: "",
        info: "",
        primary: "border-primary/40 text-primary-text",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
)

const DOT = {
  neutral: "bg-faint-foreground",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  primary: null,
} as const

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Hide the status dot, e.g. for a count or a provider label. */
  dot?: boolean
}

export function Badge({ className, tone, dot = true, children, ...props }: BadgeProps) {
  const color = DOT[tone ?? "neutral"]
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && color ? (
        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", color)} />
      ) : null}
      {children}
    </span>
  )
}

/** A bare dot for dense rows and chrome where a full badge would be noise. */
export function StatusDot({
  tone = "neutral",
  className,
}: {
  tone?: Exclude<NonNullable<BadgeProps["tone"]>, "primary">
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-1.5 shrink-0 rounded-full", DOT[tone], className)}
    />
  )
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
  error: "danger",
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
export function StatusBadge({
  status,
  label,
  className,
}: {
  status: string
  /**
   * Overrides the catalogue label when the same status word needs a different
   * noun agreement — a participation "approved" is a person, a commission
   * "approved" is a ledger row. The tone still comes from `status`.
   */
  label?: string
  className?: string
}) {
  const t = useTranslations("status")
  const tone = (TONES[status as KnownStatus] ?? "info") as NonNullable<BadgeProps["tone"]>
  const key = status.replace(/_/g, "")

  return (
    <Badge tone={tone} className={className}>
      {label ?? (t.has(key) ? t(key) : status)}
    </Badge>
  )
}
