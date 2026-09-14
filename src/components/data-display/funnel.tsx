import { getTranslations } from "next-intl/server"
import * as React from "react"

import { cn } from "@/lib/utils"
import { getFormatters } from "@/i18n/format"

/**
 * DESIGN.md §10: a funnel shows the absolute value AND the conversion rate
 * from the previous step. Rendered as an ordered list so the numbers are
 * available to a screen reader without the bars. One neutral bar colour: the
 * steps are a sequence, not categories, and colour is reserved for money.
 */
export async function Funnel({
  steps,
  className,
}: {
  steps: { key: string; value: number }[]
  className?: string
}) {
  const t = await getTranslations("dashboard.funnel")
  const f = await getFormatters()
  const max = Math.max(1, ...steps.map((s) => s.value))

  return (
    <ol className={cn("space-y-4", className)}>
      {steps.map((step, index) => {
        const previous = index > 0 ? steps[index - 1]!.value : null
        const width = Math.max(1, (step.value / max) * 100)

        return (
          <li key={step.key} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-caption">
              <span className="text-foreground-secondary">{t(step.key)}</span>
              <span className="flex items-baseline gap-2 tabular-nums">
                {previous !== null ? (
                  <span className="text-meta text-muted-foreground">
                    {f.rate(step.value, previous)}
                  </span>
                ) : null}
                <span className="text-foreground">{f.number(step.value)}</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-hairline bg-fill">
              <div
                className="h-full rounded-hairline bg-muted-foreground transition-[width] duration-200"
                style={{ width: `${width}%` }}
              />
            </div>
          </li>
        )
      })}
    </ol>
  )
}
