import { useTranslations } from "next-intl"

import { Badge } from "@/components/ui/badge"

/**
 * Which side of the ledger a program (or a payout batch) is on. Test data is
 * never mixed with live data (docs/PLANS.md §2), so it is labelled wherever a
 * row could be mistaken for the other. Informational, not a status: `info`.
 */
export function EnvironmentBadge({
  environment,
  label,
  className,
}: {
  environment: "test" | "live"
  /** Overrides the default "Test" / "Live" wording, e.g. "Test batch". */
  label?: string
  className?: string
}) {
  const t = useTranslations("common.environment")
  return (
    <Badge tone={environment === "test" ? "warning" : "info"} className={className}>
      {label ?? t(environment)}
    </Badge>
  )
}
