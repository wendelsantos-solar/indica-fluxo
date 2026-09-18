import { ChevronRight } from "lucide-react"
import { getTranslations } from "next-intl/server"

import { Badge } from "@/components/ui/badge"
import { Link } from "@/i18n/navigation"
import type { BillingEnvironment } from "@/lib/billing/types"

import type { ConnectionDisplayState, ConnectionHealth } from "./health"
import { HealthBadge } from "./health-view"
import { ProviderMark, providerName } from "./provider-mark"

export interface ConnectionCardData {
  id: string
  provider: string
  displayName: string | null
  environment: BillingEnvironment | null
  health: ConnectionHealth
  /** The badge: health, with "awaiting events" told apart from "configuring". */
  state: ConnectionDisplayState
  /** Pre-formatted on the server ("há 3 minutos"). */
  lastEventWhen: string | null
  beta: boolean
  /** A step only the founder can do is pending (Mercado Pago's panel step). */
  pendingPanelStep?: boolean
  /** A manual setup started and not finished: the card resumes it. */
  setupIncomplete?: boolean
}

/**
 * One merchant account at one provider: name, account, mode, health, last
 * event. No client id, webhook id or secret here — those live in the detail's
 * advanced section (brief §25). The whole card is the link to the detail.
 */
export async function ConnectionCard({ connection, workspaceSlug }: { connection: ConnectionCardData; workspaceSlug: string }) {
  const t = await getTranslations("dashboard.integrations.card")
  const tIssues = await getTranslations("dashboard.integrations.health.issues")
  const name = providerName(connection.provider)
  // Waiting for the first payment is what the badge already says, not a problem to repeat.
  const firstIssue = connection.health.issues.find((issue) => issue !== "awaitingFirstEvent")

  return (
    <Link
      href={{
        pathname: "/[workspaceSlug]/integrations/[connectionId]",
        params: { workspaceSlug, connectionId: connection.id },
      }}
      className="group flex items-start gap-3 rounded-panel border border-border bg-surface-1 p-4 transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
    >
      <ProviderMark provider={connection.provider} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className="min-w-0 truncate text-caption font-medium text-foreground"
            title={connection.displayName ? `${name} — ${connection.displayName}` : undefined}
          >
            {connection.displayName ? `${name} — ${connection.displayName}` : name}
          </span>
          {connection.beta ? <BetaBadge label={t("beta")} hint={t("betaHint")} className="shrink-0" /> : null}
          <HealthBadge state={connection.state} className="ml-auto shrink-0" />
        </div>
        <p className="mt-0.5 truncate text-caption text-muted-foreground">
          {t(`environment.${connection.environment ?? "both"}`)}
        </p>
        <p className="mt-2 text-meta text-muted-foreground">
          {connection.setupIncomplete ? (
            <>
              {t("incomplete")} <span className="text-foreground-secondary underline underline-offset-4">{t("resume")}</span>
            </>
          ) : connection.pendingPanelStep
            ? t("panelStep")
            : firstIssue
            ? tIssues(`${firstIssue}.title`, { provider: name })
            : connection.lastEventWhen
              ? t("lastEvent", { when: connection.lastEventWhen })
              : t("noEvent")}
        </p>
      </div>
      <ChevronRight
        className="mt-1.5 size-4 shrink-0 text-faint-foreground transition-colors group-hover:text-muted-foreground"
        aria-hidden="true"
      />
    </Link>
  )
}

/** "Beta" with its meaning one hover (and one screen-reader phrase) away — never decoration. */
export function BetaBadge({ label, hint, className }: { label: string; hint: string; className?: string }) {
  return (
    <Badge dot={false} title={hint} className={className}>
      {label}
      <span className="sr-only"> — {hint}</span>
    </Badge>
  )
}

/**
 * The overview's compact line for one account: "Mercado Pago — Loja BR · Beta ·
 * Saudável". Same link as the card; the detail page holds everything else.
 */
export async function ConnectionRow({ connection, workspaceSlug }: { connection: ConnectionCardData; workspaceSlug: string }) {
  const t = await getTranslations("dashboard.integrations.card")
  const name = providerName(connection.provider)
  return (
    <li>
      <Link
        href={{
          pathname: "/[workspaceSlug]/integrations/[connectionId]",
          params: { workspaceSlug, connectionId: connection.id },
        }}
        className="group flex items-center gap-3 py-3 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
      >
        <ProviderMark provider={connection.provider} />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2 text-caption text-foreground">
            <span className="truncate font-medium">{name}</span>
            {connection.beta ? <BetaBadge label={t("beta")} hint={t("betaHint")} className="shrink-0" /> : null}
          </p>
          <p className="mt-0.5 truncate text-meta text-muted-foreground" title={connection.displayName ?? undefined}>
            {connection.displayName ? `${connection.displayName} · ` : ""}
            {t(`environment.${connection.environment ?? "both"}`)}
            {connection.pendingPanelStep ? ` · ${t("panelStep")}` : ""}
            {connection.setupIncomplete ? ` · ${t("incomplete")}` : ""}
          </p>
        </div>
        <HealthBadge state={connection.state} className="shrink-0" />
        <ChevronRight className="size-4 shrink-0 text-faint-foreground transition-colors group-hover:text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  )
}
