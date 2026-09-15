import { Check, Minus } from "lucide-react"
import { useTranslations } from "next-intl"

import type { PlanLine } from "@/lib/plans"
import { cn } from "@/lib/utils"

/** A line from `planLines()`, or an ungated item the caller adds (pricing). */
export type RenderablePlanLine = PlanLine | { kind: "base"; item: string }

function lineKey(line: RenderablePlanLine): string {
  if (line.kind === "limit") return `limit-${line.resource}`
  if (line.kind === "feature") return `feature-${line.feature}`
  return `base-${line.item}`
}

/**
 * "What this plan includes", worded from the same table enforcement reads.
 * Shared by the pricing page and the Settings plan panel. A feature the plan
 * lacks stays in the list, muted and marked, so two plans compare line by line.
 */
export function PlanLineList({ lines, className }: { lines: RenderablePlanLine[]; className?: string }) {
  const t = useTranslations("plans.lines")

  return (
    <ul className={cn("space-y-2.5", className)}>
      {lines.map((line) => {
        const included = line.kind !== "feature" || line.included
        const label =
          line.kind === "limit"
            ? line.limit === null
              ? t(`unlimited.${line.resource}`)
              : t(`limit.${line.resource}`, { count: line.limit })
            : line.kind === "feature"
              ? t(`feature.${line.feature}`)
              : t(`base.${line.item}`)

        return (
          <li key={lineKey(line)} className="flex items-start gap-2 text-caption">
            {included ? (
              <Check className="mt-0.5 size-3.5 shrink-0 text-faint-foreground" aria-hidden="true" />
            ) : (
              <Minus className="mt-0.5 size-3.5 shrink-0 text-faint-foreground" aria-hidden="true" />
            )}
            <span className={included ? "text-foreground-secondary" : "text-muted-foreground line-through"}>
              {label}
              {included ? null : <span className="sr-only"> ({t("notIncluded")})</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
