import { cn } from "@/lib/utils"

/**
 * A mark, not an illustration: a solid lime square with the wordmark beside it.
 * The accent appears here because a logo is identity, not a call to action.
 */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <span
        aria-hidden="true"
        className="relative flex size-5 items-center justify-center rounded-[5px] bg-primary"
      >
        <span className="size-1.5 rounded-[1px] bg-primary-foreground" />
      </span>
      {!compact ? (
        <span className="text-[14px] font-medium tracking-[-0.02em] text-foreground">Indica</span>
      ) : null}
    </span>
  )
}
