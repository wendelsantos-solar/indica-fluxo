import { ArrowRight, Check } from "lucide-react"
import { getTranslations } from "next-intl/server"
import type * as React from "react"

import { Button } from "@/components/ui/button"
import { InviteAffiliateDialog } from "@/features/affiliates/invite-affiliate-dialog"
import { getFormatters } from "@/i18n/format"
import { Link } from "@/i18n/navigation"
import { cn } from "@/lib/utils"

import type { Activation, ActivationStepKey } from "./activation"
import { OnboardingStepper } from "./onboarding-stepper"

type Href = React.ComponentProps<typeof Link>["href"]

export interface ActivationProgram {
  id: string
  name: string
  status: "draft" | "active" | "paused" | "archived"
  commissionType: "percentage" | "fixed"
  commissionValue: number
  commissionDurationMonths: number | null
  currency: string
  /** From `listPrograms`; lets "Testar uma conversão" open the test program. */
  slug?: string
  environment?: "test" | "live"
}

function stepHref(
  key: ActivationStepKey,
  done: boolean,
  workspaceSlug: string,
  testProgramSlug: string | null,
): Href {
  const params = { workspaceSlug }
  switch (key) {
    case "workspace":
      return { pathname: "/[workspaceSlug]/settings", params }
    case "program":
      return done
        ? { pathname: "/[workspaceSlug]/programs", params }
        : { pathname: "/[workspaceSlug]/programs/new", params }
    case "affiliate":
      return { pathname: "/[workspaceSlug]/affiliates", params }
    case "stripe":
      return { pathname: "/[workspaceSlug]/integrations", params }
    case "tracking":
      // Straight to the tracking section, not the top of Integrations.
      return { pathname: "/[workspaceSlug]/integrations", params, hash: "tracking" }
    case "testConversion":
      // The simulation lives on the test program's page.
      return testProgramSlug
        ? { pathname: "/[workspaceSlug]/programs/[programSlug]", params: { workspaceSlug, programSlug: testProgramSlug } }
        : { pathname: "/[workspaceSlug]/programs", params }
    case "liveMode":
      return { pathname: "/[workspaceSlug]/settings", params, hash: "plano" }
  }
}

/** The newest test program, where a conversion can be simulated. */
function testProgramSlug(programs: readonly { slug?: string; environment?: "test" | "live"; status?: string }[]) {
  return programs.find((program) => program.environment === "test" && program.status !== "archived")?.slug ?? null
}

/**
 * The overview's main content while setup is incomplete and nothing has
 * happened yet (see `shouldShowActivationChecklist`): what
 * was just achieved, then the steps between here and a first commission —
 * with the Sandbox journey (test conversion, live mode) when the overview
 * passes `liveMode` to `activationSignals`.
 * One primary action — on the next pending step — and nothing else competing.
 */
export async function ActivationChecklist({
  workspaceSlug,
  activation,
  programs,
  welcome,
}: {
  workspaceSlug: string
  activation: Activation
  /** Newest first, as `listPrograms` returns them. */
  programs: ActivationProgram[]
  /** Arrived straight from the onboarding program form. */
  welcome: boolean
}) {
  const t = await getTranslations("dashboard.overview.activation")
  const f = await getFormatters()

  const latest = programs[0] ?? null

  const programLine = latest
    ? t("programLine", {
        program: latest.name,
        rule: t("rule", {
          type: latest.commissionType,
          amount:
            latest.commissionType === "percentage"
              ? f.basisPoints(latest.commissionValue)
              : f.money(latest.commissionValue, latest.currency),
          recurrence:
            latest.commissionDurationMonths === null
              ? "lifetime"
              : latest.commissionDurationMonths === 1
                ? "first"
                : "months",
          months: latest.commissionDurationMonths ?? 0,
        }),
      })
    : null

  const headline = !latest
    ? t("headlineNoProgram")
    : welcome && latest.status === "active"
      ? t("headlineLive")
      : t("headlineReady")

  const subline = !latest
    ? t("descriptionNoProgram")
    : welcome || programs.length === 1
      ? programLine
      : t("programCount", { count: programs.length })

  return (
    <section aria-labelledby="activation-title" className="max-w-2xl pb-8">
      {welcome && latest ? <OnboardingStepper current="done" className="mb-8 max-w-md" /> : null}

      <div className="space-y-1.5">
        <h2 id="activation-title" className="text-balance text-title text-foreground">
          {headline}
        </h2>
        {subline ? (
          <p className="text-pretty text-caption text-muted-foreground">{subline}</p>
        ) : null}
      </div>

      <div className="mt-8">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id="activation-checklist" className="text-caption font-medium text-foreground">
            {t("checklistTitle")}
          </h3>
          <p aria-hidden="true" className="text-meta tabular-nums text-muted-foreground">
            {t("progress", { done: activation.doneCount, total: activation.total })}
          </p>
        </div>

        {/* Segments rather than a width, so progress needs no inline style and
            each segment stands for one step. Filled by count, left to right. */}
        <div
          role="progressbar"
          aria-labelledby="activation-checklist"
          aria-valuemin={0}
          aria-valuemax={activation.total}
          aria-valuenow={activation.doneCount}
          aria-valuetext={t("progress", { done: activation.doneCount, total: activation.total })}
          className="mt-2 flex gap-1"
        >
          {activation.steps.map((step, index) => (
            <span
              key={step.key}
              className={cn(
                "h-1 flex-1 rounded-full",
                index < activation.doneCount ? "bg-foreground-secondary" : "bg-fill-strong",
              )}
            />
          ))}
        </div>

        <ol aria-labelledby="activation-checklist" className="mt-4 border-t border-border">
          {activation.steps.map(({ key, done, waiting }) => {
            const isNext = activation.next === key
            // Stripe saved but silent: not "connected" until an event proves it.
            const title = done
              ? t(`steps.${key}.titleDone`)
              : waiting
                ? t("steps.stripe.titleWaiting")
                : t(`steps.${key}.title`)
            const label = done
              ? t(`steps.${key}.actionDone`)
              : waiting
                ? t("steps.stripe.actionWaiting")
                : t(`steps.${key}.action`)

            let action: React.ReactNode
            if (key === "affiliate" && !done && latest) {
              // Inviting happens in place: the dialog is the whole task.
              action = (
                <InviteAffiliateDialog
                  workspaceSlug={workspaceSlug}
                  programs={programs.map((program) => ({ id: program.id, name: program.name }))}
                  defaultProgramId={latest.id}
                  triggerLabel={label}
                  triggerVariant={isNext ? "primary" : "secondary"}
                  triggerSize={isNext ? "md" : "sm"}
                />
              )
            } else {
              action = (
                <Button
                  asChild
                  variant={isNext ? "primary" : done ? "ghost" : "secondary"}
                  size={isNext ? "md" : "sm"}
                >
                  <Link href={stepHref(key, done, workspaceSlug, testProgramSlug(programs))}>
                    {label}
                    {isNext ? <ArrowRight aria-hidden="true" /> : null}
                  </Link>
                </Button>
              )
            }

            return (
              <li
                key={key}
                aria-current={isNext ? "step" : undefined}
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-faint",
                  isNext ? "py-4" : "py-3",
                )}
              >
                <StepMarker done={done} next={isNext} />

                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-caption",
                      done
                        ? "text-muted-foreground"
                        : isNext
                          ? "font-medium text-foreground"
                          : "text-foreground-secondary",
                    )}
                  >
                    {title}
                    <span className="sr-only"> {done ? t("srDone") : t("srPending")}</span>
                  </p>
                  {isNext ? (
                    <p className="mt-0.5 max-w-prose text-pretty text-caption text-muted-foreground">
                      {waiting ? t("steps.stripe.descriptionWaiting") : t(`steps.${key}.description`)}
                    </p>
                  ) : null}
                </div>

                <div className={cn("shrink-0", isNext && "max-sm:basis-full max-sm:pl-8")}>
                  {action}
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}

function StepMarker({ done, next }: { done: boolean; next: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full",
        done
          ? "bg-fill-strong text-foreground-secondary"
          : next
            ? "border border-foreground"
            : "border border-dashed border-border-strong",
      )}
    >
      {done ? <Check className="size-3" strokeWidth={2.25} /> : null}
    </span>
  )
}

/**
 * Once numbers flow, the checklist steps aside. If something that decides
 * whether those numbers become commissions is still missing — typically Stripe
 * while clicks already arrive — one quiet line keeps it in view. No card, no
 * primary, no dismiss: it disappears by itself when the step is done.
 */
export async function ActivationReminder({
  workspaceSlug,
  activation,
  programs = [],
}: {
  workspaceSlug: string
  activation: Activation
  /** Optional: lets the "Testar uma conversão" reminder open the test program. */
  programs?: readonly Pick<ActivationProgram, "slug" | "environment" | "status">[]
}) {
  if (!activation.next) return null
  const t = await getTranslations("dashboard.overview.activation")
  const nextStep = activation.steps.find((step) => step.key === activation.next)

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption">
      <span className="tabular-nums text-muted-foreground">
        {t("reminder", { done: activation.doneCount, total: activation.total })}
      </span>
      <Link
        href={stepHref(activation.next, false, workspaceSlug, testProgramSlug(programs))}
        className="inline-flex items-center gap-1 rounded-badge text-foreground-secondary transition-colors duration-[120ms] hover:text-foreground"
      >
        {nextStep?.waiting ? t("steps.stripe.titleWaiting") : t(`steps.${activation.next}.title`)}
        <ArrowRight className="size-3.5" aria-hidden="true" />
      </Link>
    </p>
  )
}
