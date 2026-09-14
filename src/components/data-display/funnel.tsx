import * as React from "react"

import { cn } from "@/lib/utils"
import { getFormatters } from "@/i18n/format"

/**
 * DESIGN.md §10: a funnel shows the absolute value AND the conversion rate
 * from the previous step. Rendered as a definition list so the numbers are
 * available to a screen reader without the bars.
 */
export async function Funnel({
  steps,
  className,
}: {
  steps: { label: string; value: number }[]
  className?: string
}) {
  const f = await getFormatters()
  const max = Math.max(1, ...steps.map((s) => s.value))

  return (
    <ol className={cn("space-y-3", className)}>
      {steps.map((step, index) => {
        const previous = index > 0 ? steps[index - 1]!.value : null
        const width = Math.max(2, (step.value / max) * 100)

        return (
          <li key={step.label} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-caption text-foreground-secondary">{step.label}</span>
              <span className="flex items-baseline gap-2">
                <span className="font-medium tabular-nums text-foreground">
                  {f.number(step.value)}
                </span>
                {previous !== null ? (
                  <span className="text-meta tabular-nums text-muted-foreground">
                    {f.rate(step.value, previous)}
                  </span>
                ) : null}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full transition-[width] duration-[200ms]"
                style={{
                  width: `${width}%`,
                  backgroundColor: `var(--chart-${(index % 6) + 1})`,
                }}
              />
            </div>
          </li>
        )
      })}
    </ol>
  )
}
