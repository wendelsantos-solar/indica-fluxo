import { getTranslations } from "next-intl/server"
import type * as React from "react"

import { Badge, StatusDot } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

import {
  HEALTH_STAGES,
  displayTone,
  type ConnectionDisplayState,
  type ConnectionHealth,
  type HealthIssue,
  type StageStatus,
} from "./health"

/**
 * Server-only (they translate on the server, so no catalogue ships to the browser).
 */

/** "● Saudável" / "● Aguardando eventos" / "● Ação necessária" — the one badge a connection shows. */
export async function HealthBadge({ state, className }: { state: ConnectionDisplayState; className?: string }) {
  const t = await getTranslations("dashboard.integrations.health.overall")
  return (
    <Badge tone={displayTone(state)} className={className}>
      {t(state)}
    </Badge>
  )
}

const STAGE_TONE: Record<StageStatus, "success" | "warning" | "danger" | "neutral"> = {
  healthy: "success",
  warning: "warning",
  error: "danger",
  unknown: "neutral",
}

/** Authorization · Payment events · Customers · Attribution · Commissions, each with its state. */
export async function HealthStages({ health }: { health: ConnectionHealth }) {
  const t = await getTranslations("dashboard.integrations.health")
  return (
    <ul className="divide-y divide-border-faint border-y border-border">
      {HEALTH_STAGES.map((stage) => {
        const status = health.stages[stage]
        return (
          <li key={stage} className="flex items-center justify-between gap-4 py-2.5">
            <span className="text-caption text-foreground-secondary">{t(`stages.${stage}`)}</span>
            <span className="flex items-center gap-2 text-caption text-muted-foreground">
              <StatusDot tone={STAGE_TONE[status]} />
              {t(`stageStatus.${stage}.${status}`)}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * What happened, what it affects, what to do — one block per issue, most
 * important first (brief §65). Plain language; the technical detail lives in
 * the advanced section.
 */
export async function HealthIssues({
  issues,
  provider,
  actions,
  className,
}: {
  issues: readonly HealthIssue[]
  provider: string
  /** An action per issue, when the page has one (reconnect, open setup). */
  actions?: Partial<Record<HealthIssue, React.ReactNode>>
  className?: string
}) {
  const t = await getTranslations("dashboard.integrations.health.issues")
  if (issues.length === 0) return null
  return (
    <ul className={cn("space-y-2", className)}>
      {issues.map((issue) => (
        <li key={issue} className="rounded-control border border-border px-3 py-2.5">
          <p className="text-caption font-medium text-foreground">{t(`${issue}.title`, { provider })}</p>
          <p className="mt-0.5 text-caption text-muted-foreground">{t(`${issue}.affects`, { provider })}</p>
          <p className="mt-0.5 text-caption text-foreground-secondary">{t(`${issue}.action`, { provider })}</p>
          {actions?.[issue] ? <div className="mt-3 max-w-md">{actions[issue]}</div> : null}
        </li>
      ))}
    </ul>
  )
}
