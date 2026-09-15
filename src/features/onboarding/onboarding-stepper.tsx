import { Check } from "lucide-react"
import { useTranslations } from "next-intl"
import * as React from "react"

import { cn } from "@/lib/utils"

const STEPS = ["workspace", "program", "done"] as const

export type OnboardingStep = (typeof STEPS)[number]

/**
 * The three-step progress marker shared by the onboarding screen, the
 * onboarding variant of "New program" and the welcome overview.
 *
 * Text labels, not dots: a founder should read where they are, not decode it.
 * Completed steps carry a check icon and a visually hidden "completed", so the
 * state never rests on colour alone. The final step is marked done as soon as
 * it is reached — arriving there is what completes it.
 */
export function OnboardingStepper({
  current,
  className,
}: {
  current: OnboardingStep
  className?: string
}) {
  const t = useTranslations("onboarding.stepper")
  const currentIndex = STEPS.indexOf(current)
  const lastIndex = STEPS.length - 1

  return (
    <ol aria-label={t("label")} className={cn("flex items-center gap-2", className)}>
      {STEPS.map((step, index) => {
        const isCurrent = index === currentIndex
        const isDone = index < currentIndex || (isCurrent && index === lastIndex)

        return (
          <React.Fragment key={step}>
            {index > 0 ? (
              <li
                aria-hidden="true"
                className={cn(
                  "h-px min-w-3 flex-1",
                  index <= currentIndex ? "bg-border-strong" : "bg-border",
                )}
              />
            ) : null}
            <li
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-1.5 text-meta",
                isCurrent
                  ? "font-medium text-foreground"
                  : isDone
                    ? "text-muted-foreground"
                    : "text-faint-foreground",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-4 items-center justify-center rounded-full border text-micro tabular-nums",
                  isDone
                    ? "border-transparent bg-fill-strong text-foreground"
                    : isCurrent
                      ? "border-foreground text-foreground"
                      : "border-border-strong",
                )}
              >
                {isDone ? <Check className="size-2.5" strokeWidth={2.5} /> : index + 1}
              </span>
              {t(step)}
              {isDone && !isCurrent ? <span className="sr-only">{t("completed")}</span> : null}
            </li>
          </React.Fragment>
        )
      })}
    </ol>
  )
}
