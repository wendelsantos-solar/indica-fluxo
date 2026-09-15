import { Check } from "lucide-react"
import { getTranslations } from "next-intl/server"

import { lineId, lineMessage, type DisplayLine } from "@/lib/plans-display"
import { cn } from "@/lib/utils"

/**
 * A plan's lines as the pricing page and the landing render them. Every line
 * comes from `src/lib/plans-display.ts`, which derives it from
 * `PLAN_CAPABILITIES`; this component only words and draws it. Only what a plan
 * includes is listed — nothing struck through.
 */
export async function PlanLines({ lines, className }: { lines: readonly DisplayLine[]; className?: string }) {
  const t = await getTranslations()

  return (
    <ul className={cn("space-y-2.5", className)}>
      {lines.map((line) => {
        const message = lineMessage(line)
        return (
          <li key={lineId(line)} className="flex items-start gap-2 text-caption text-foreground-secondary">
            <Check className="mt-0.5 size-3.5 shrink-0 text-faint-foreground" aria-hidden="true" />
            <span>{t(message.key, message.values)}</span>
          </li>
        )
      })}
    </ul>
  )
}
