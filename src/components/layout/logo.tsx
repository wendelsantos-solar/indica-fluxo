import { cn } from "@/lib/utils"

/**
 * A mark, not an illustration: two paths merging into one — a referral
 * becoming a flow. The amber stroke is identity, not a call to action, which
 * is why it may appear beside the one primary button without competing.
 */
export function Logo({
  className,
  labelClassName,
  compact = false,
}: {
  className?: string
  /** E.g. `SIDEBAR_LABEL`, so the icon rail keeps only the mark. */
  labelClassName?: string
  compact?: boolean
}) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
        <path
          d="M2.5 3.5c3 0 4 4.5 6.5 4.5M2.5 12.5c3 0 4-4.5 6.5-4.5"
          fill="none"
          stroke="var(--faint-foreground)"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
        <path d="M9 8h4.5" fill="none" stroke="var(--primary)" strokeWidth="2.25" strokeLinecap="round" />
      </svg>
      {!compact ? (
        // 510, not 590: the brand names the frame, it is not the loudest text on screen.
        <span className={cn("truncate text-caption font-medium text-foreground", labelClassName)}>
          IndicaFluxo
        </span>
      ) : null}
    </span>
  )
}
