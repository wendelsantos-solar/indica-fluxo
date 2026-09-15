"use client"

import { FlaskConical } from "lucide-react"
import { useTranslations } from "next-intl"
import * as React from "react"

import { Link, useRouter } from "@/i18n/navigation"

import { RailTooltip, SIDEBAR_CENTER_IN_RAIL, SIDEBAR_LABEL } from "@/components/layout/app-shell"
import { Button } from "@/components/ui/button"
import { setViewEnvironmentAction } from "@/features/environment/actions"
import type { ViewEnvironment } from "@/lib/view-environment"
import { cn } from "@/lib/utils"

export interface ShellEnvironment {
  environment: ViewEnvironment
  /** False on a Sandbox workspace: it only has test data. */
  switchable: boolean
  /** The plan processes live data now. */
  liveModeAvailable: boolean
}

/**
 * Stores the choice and re-renders the route: every page reads the
 * environment on the server, so nothing on the client needs to change by hand.
 * Optimistic, so the switch moves at once.
 */
function useSwitchEnvironment(workspaceSlug: string, environment: ViewEnvironment) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [optimistic, setOptimistic] = React.useOptimistic(environment)

  const select = React.useCallback(
    (next: ViewEnvironment) => {
      startTransition(async () => {
        setOptimistic(next)
        await setViewEnvironmentAction({ workspaceSlug, environment: next })
        router.refresh()
      })
    },
    [router, setOptimistic, workspaceSlug],
  )

  return { current: optimistic, pending, select }
}

/**
 * The sidebar's Live / Test control (DESIGN.md §11). Stripe-style: one switch,
 * "Dados de teste", on when the dashboard shows test data. Neutral — the
 * accent stays on the page's one primary action. A Sandbox workspace has
 * nothing to switch to: a badge says so and leads to the plans.
 */
export function EnvironmentControl({
  workspaceSlug,
  environment,
  switchable,
}: ShellEnvironment & { workspaceSlug: string }) {
  const t = useTranslations("nav.environment")
  const { current, pending, select } = useSwitchEnvironment(workspaceSlug, environment)

  if (!switchable) {
    return (
      <RailTooltip label={t("sandboxBadge")}>
        <Link
          href={{ pathname: "/[workspaceSlug]/settings", params: { workspaceSlug }, hash: "plano" }}
          aria-label={t("sandboxLabel")}
          className={cn(
            "flex h-8 items-center gap-2.5 rounded-control px-2 text-caption text-muted-foreground transition-colors duration-[120ms] hover:bg-hover hover:text-foreground touch:h-10",
            SIDEBAR_CENTER_IN_RAIL,
          )}
        >
          <FlaskConical className="size-4 shrink-0" aria-hidden="true" />
          <span
            className={cn(
              SIDEBAR_LABEL,
              "truncate rounded-badge border border-border px-1.5 text-meta font-medium leading-5 text-foreground-secondary",
            )}
          >
            {t("sandboxBadge")}
          </span>
        </Link>
      </RailTooltip>
    )
  }

  const test = current === "test"
  return (
    <RailTooltip label={test ? t("testOn") : t("testOff")}>
      <button
        type="button"
        role="switch"
        aria-checked={test}
        aria-label={t("switchLabel")}
        aria-busy={pending || undefined}
        onClick={() => select(test ? "live" : "test")}
        className={cn(
          "flex h-8 w-full items-center gap-2.5 rounded-control px-2 text-caption font-medium transition-colors duration-[120ms] hover:bg-hover touch:h-10",
          test ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          SIDEBAR_CENTER_IN_RAIL,
        )}
      >
        <FlaskConical className="size-4 shrink-0" aria-hidden="true" />
        <span className={cn(SIDEBAR_LABEL, "flex-1 truncate text-left")}>{t("switchLabel")}</span>
        <span
          aria-hidden="true"
          className={cn(
            SIDEBAR_LABEL,
            "relative h-4 w-7 shrink-0 rounded-full border transition-colors duration-[120ms]",
            test ? "border-foreground bg-foreground" : "border-border-strong bg-fill",
          )}
        >
          <span
            className={cn(
              "absolute top-1/2 size-3 -translate-y-1/2 rounded-full transition-[left] duration-[120ms]",
              test ? "left-3 bg-surface-1" : "left-0.5 bg-faint-foreground",
            )}
          />
        </span>
      </button>
    </RailTooltip>
  )
}

/**
 * The strip across the top of the content panel whenever the page is not
 * plain live data: test data (with the way back to live when there is one),
 * Sandbox, or live data kept readable on a plan without live mode.
 */
export function EnvironmentStrip({
  workspaceSlug,
  environment,
  switchable,
  liveModeAvailable,
}: ShellEnvironment & { workspaceSlug: string }) {
  const t = useTranslations("nav.environment")
  const { pending, select } = useSwitchEnvironment(workspaceSlug, environment)
  const plansHref = { pathname: "/[workspaceSlug]/settings", params: { workspaceSlug }, hash: "plano" } as const

  let message: string
  let action: React.ReactNode = null
  if (!switchable) {
    message = t("strip.sandbox")
    action = (
      <Button asChild variant="ghost" size="sm">
        <Link href={plansHref}>{t("strip.viewPlans")}</Link>
      </Button>
    )
  } else if (environment === "test") {
    message = t("strip.test")
    action = (
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => select("live")}>
        {t("strip.showLive")}
      </Button>
    )
  } else if (!liveModeAvailable) {
    message = t("strip.liveReadOnly")
    action = (
      <Button asChild variant="ghost" size="sm">
        <Link href={plansHref}>{t("strip.viewPlans")}</Link>
      </Button>
    )
  } else {
    return null
  }

  return (
    <div
      role="status"
      className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-fill-subtle px-4 py-1 text-meta text-muted-foreground md:rounded-t-panel md:px-6"
    >
      <FlaskConical className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-pretty">{message}</span>
      {action}
    </div>
  )
}
