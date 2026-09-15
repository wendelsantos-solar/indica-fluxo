import { Check, Minus } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"

import { formatNumber } from "@/lib/money"
import type { PlanCode } from "@/lib/plans"
import { cn } from "@/lib/utils"

import { capabilityLines, type CapabilityLine } from "./plan-display"

function lineKey(line: CapabilityLine): string {
  return line.kind === "limit" ? `limit-${line.limit}` : `feature-${line.feature}`
}

/**
 * "What this plan includes", worded from `PLAN_CAPABILITIES` — the table
 * enforcement reads — so a card cannot promise what the server refuses. A
 * feature the plan lacks stays in the list, muted and marked, so two plans
 * compare line by line.
 */
export function PlanLineList({ plan, className }: { plan: PlanCode; className?: string }) {
  const t = useTranslations("plans.capabilities")
  const locale = useLocale()

  return (
    <ul className={cn("space-y-2", className)}>
      {capabilityLines(plan).map((line) => {
        const included = line.kind === "limit" ? line.max !== 0 : line.included
        const label =
          line.kind === "limit"
            ? line.max === null
              ? t(`unlimited.${line.limit}`)
              : t(`limit.${line.limit}`, { count: line.max, formatted: formatNumber(locale, line.max) })
            : t(`feature.${line.feature}`)

        return (
          <li key={lineKey(line)} className="flex items-start gap-2 text-caption">
            {included ? (
              <Check className="mt-0.5 size-3.5 shrink-0 text-faint-foreground" aria-hidden="true" />
            ) : (
              <Minus className="mt-0.5 size-3.5 shrink-0 text-faint-foreground" aria-hidden="true" />
            )}
            <span className={included ? "text-foreground-secondary" : "text-muted-foreground"}>
              {label}
              {included ? null : <span className="sr-only"> ({t("notIncluded")})</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
