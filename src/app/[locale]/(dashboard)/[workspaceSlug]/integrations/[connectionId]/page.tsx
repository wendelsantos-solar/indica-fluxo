import { CheckCircle2, ChevronDown, Circle } from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import type * as React from "react"
import { z } from "zod"

import { InlineAlert } from "@/components/feedback/inline-alert"
import { PageHeader, SectionHeader } from "@/components/layout/page-header"
import { Badge, StatusDot } from "@/components/ui/badge"
import { AutoRefresh } from "@/features/integrations/auto-refresh"
import { CodeField } from "@/features/integrations/code-field"
import {
  DisconnectConnection,
  ReconnectForm,
  RenameForm,
  WebhookSecretForm,
} from "@/features/integrations/connection-manage"
import { BetaBadge } from "@/features/integrations/connection-card"
import { connectionDisplayState, connectionPresence } from "@/features/integrations/health"
import { HealthBadge, HealthIssues, HealthStages } from "@/features/integrations/health-view"
import { providerName } from "@/features/integrations/provider-mark"
import { StripePanel } from "@/features/integrations/stripe-panel"
import { attributionIssue, deriveStripeState, formatRelativeTime } from "@/features/integrations/stripe-status"
import { getFormatters } from "@/i18n/format"
import { Link } from "@/i18n/navigation"
import { CAPABILITY_KEYS, CONNECTORS, isConnectorId } from "@/lib/billing/catalog"
import { isApiConnectorId } from "@/lib/billing/connectors"
import { MERCADO_PAGO_TOPICS } from "@/lib/billing/mercado-pago/connector"
import { stripeWebhookPath } from "@/lib/billing/stripe/events"
import { appUrl as appOrigin } from "@/lib/site"
import { cn } from "@/lib/utils"
import { requireUser } from "@/server/auth/session"
import { canManageApiKeys, listApiKeys } from "@/server/services/api-keys"
import { connectorWebhookUrl } from "@/server/services/billing-connections"
import {
  diagnoseRecentPayments,
  getIntegrationOverview,
  listConnectionEvents,
  type PaymentDiagnosis,
  type PipelineState,
  type PipelineStep,
} from "@/server/services/connection-health"
import { ATTRIBUTION_WINDOW_DAYS, getIntegrationHealth } from "@/server/services/integration-health"
import { getStripeSetup } from "@/server/services/integrations"
import { stripeConnectAvailable } from "@/server/services/stripe-connect"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/[workspaceSlug]/integrations/[connectionId]">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.integrations.detail" })
  return { title: t("metaTitle") }
}

/**
 * "Why did this sale not earn a commission?" — in the order a founder reasons
 * about it. `transaction` is folded into "payment received": a payment on this
 * list is, by definition, recorded.
 */
const PIPELINE: PipelineStep[] = ["referral", "customer", "providerEvent", "billingIdentity", "attribution", "commission"]
const PIPELINE_TONE: Record<PipelineState, "success" | "danger" | "neutral"> = { ok: "success", missing: "danger", notApplicable: "neutral" }
/** Which missing step explains a payment, first match wins. */
const EXPLAINED: ReadonlyArray<Extract<PipelineStep, "billingIdentity" | "attribution" | "commission">> = ["billingIdentity", "attribution", "commission"]

/**
 * One connection: is it healthy, why not, what to do — then diagnostics, then
 * the technical detail, folded (brief §26, §35). Provider jargon (webhook ids,
 * secrets, event names) only appears in the advanced section.
 */
export default async function ConnectionPage({
  params,
}: PageProps<"/[locale]/[workspaceSlug]/integrations/[connectionId]">) {
  const { workspaceSlug, connectionId } = await params
  if (!z.uuid().safeParse(connectionId).success) notFound()

  const t = await getTranslations("dashboard.integrations")
  const locale = await getLocale()
  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)
  const isAdmin = canManageApiKeys(workspace.role)

  const overview = await getIntegrationOverview(user.id, workspace.id)
  const connection = overview.connections.find((row) => row.id === connectionId)
  if (!connection) notFound()

  const [events, payments, f] = await Promise.all([
    listConnectionEvents(user.id, workspace.id, connection.id, 15),
    diagnoseRecentPayments(user.id, workspace.id, { provider: connection.provider, limit: 8 }),
    getFormatters(workspace.timezone),
  ])
  const now = new Date()
  const relative = (value: Date | null) => (value ? formatRelativeTime(locale, value, now) : null)
  const name = providerName(connection.provider)
  const label = connection.displayName ? `${name} — ${connection.displayName}` : name
  const descriptor = isConnectorId(connection.provider) ? CONNECTORS[connection.provider] : null
  const apiProvider = isApiConnectorId(connection.provider) ? connection.provider : null
  const webhookUrl = apiProvider ? connectorWebhookUrl(apiProvider, connection.id) : null
  const awaitingMercadoPagoWebhook = connection.provider === "mercado_pago" && connection.status === "pending"
  const beta = isConnectorId(connection.provider) && overview.availability[connection.provider] === "beta"
  // "Waiting for the first event" is a state (Configurando), not a problem: the
  // status line and the stages already say it. Attention is for what needs a fix.
  const attention = connection.health.issues.filter((issue) => issue !== "awaitingFirstEvent")
  const setupIncomplete = connectionPresence(connection) === "setupIncomplete"

  return (
    <>
      <AutoRefresh active={connection.health.overall === "connecting"} />
      <PageHeader
        title={label}
        breadcrumb={[
          <Link key="integrations" href={{ pathname: "/[workspaceSlug]/integrations", params: { workspaceSlug }, query: { tab: "payments" } }}>
            {t("title")}
          </Link>,
        ]}
      />

      <div className="space-y-8">
        <section className="space-y-4">
          <dl className="grid grid-cols-1 border-y border-border sm:grid-cols-3">
            <div className="min-w-0 py-3 sm:pr-4">
              <dt className="text-caption text-muted-foreground">{t("detail.meta.status")}</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2">
                <HealthBadge state={connectionDisplayState(connection.health, connection.status, connectionPresence(connection))} />
                {beta ? <BetaBadge label={t("card.beta")} hint={t("card.betaHint")} /> : null}
              </dd>
            </div>
            <div className="min-w-0 border-border py-3 max-sm:border-t sm:border-l sm:px-4">
              <dt className="text-caption text-muted-foreground">{t("detail.meta.environment")}</dt>
              <dd className="mt-1 text-caption text-foreground">{t(`card.environment.${connection.environment ?? "both"}`)}</dd>
            </div>
            <div className="min-w-0 border-border py-3 max-sm:border-t sm:border-l sm:pl-4">
              <dt className="text-caption text-muted-foreground">{t("detail.meta.lastEvent")}</dt>
              <dd className="mt-1 text-caption text-foreground">{relative(connection.lastEventAt) ?? t("detail.meta.none")}</dd>
            </div>
          </dl>
          {beta ? (
            <InlineAlert title={t("beta.title")}>{t("beta.body")}</InlineAlert>
          ) : null}
        </section>

        {attention.length > 0 ? (
          <section className="space-y-3">
            <SectionHeader title={t("detail.attentionTitle")} className="mb-0" />
            <HealthIssues
              issues={attention}
              provider={name}
              actions={
                isAdmin && apiProvider
                  ? {
                      authFailed: <ReconnectForm workspaceSlug={workspaceSlug} integrationId={connection.id} provider={apiProvider} providerName={name} />,
                    }
                  : undefined
              }
            />
          </section>
        ) : null}

        {connection.provider === "mercado_pago" && webhookUrl && (awaitingMercadoPagoWebhook || connection.health.overall === "connecting") ? (
          <section className="space-y-4">
            <SectionHeader
              title={awaitingMercadoPagoWebhook ? t("detail.mercadoPagoWebhook.title") : t("detail.mercadoPagoWebhook.waitingTitle")}
              description={awaitingMercadoPagoWebhook ? t("detail.mercadoPagoWebhook.description") : t("detail.mercadoPagoWebhook.waitingBody")}
              className="mb-0"
            />
            {/* One numbered list: the connection's three steps. The panel
                instructions live inside step 2, lettered, so two numbered lists
                never sit side by side (brief §18). */}
            <ol aria-label={t("detail.mercadoPagoWebhook.progressLabel")} className="divide-y divide-border-faint border-y border-border">
              {(
                [
                  ["connect", true],
                  ["notify", !awaitingMercadoPagoWebhook],
                  ["verify", connection.events > 0],
                ] as const
              ).map(([step, done], index) => {
                const current = step === "notify" ? awaitingMercadoPagoWebhook : step === "verify" ? !awaitingMercadoPagoWebhook && !done : false
                return (
                  <li key={step} className="py-3">
                    <p className="flex items-center gap-2.5 text-caption">
                      {done ? (
                        <CheckCircle2 className="size-4 shrink-0 text-success-foreground" aria-hidden="true" />
                      ) : (
                        <Circle className={cn("size-4 shrink-0", current ? "text-foreground-secondary" : "text-faint-foreground")} aria-hidden="true" />
                      )}
                      <span className={cn(done ? "text-foreground-secondary" : current ? "font-medium text-foreground" : "text-muted-foreground")}>
                        {index + 1}. {t(`detail.mercadoPagoWebhook.progress.${step}`)}
                      </span>
                      <span className="sr-only">{done ? t("setup.done") : t("setup.pending")}</span>
                    </p>
                    {step === "notify" && awaitingMercadoPagoWebhook ? (
                      <div className="ml-2 mt-3 space-y-4 border-l border-border pl-5">
                        <ol className="max-w-prose list-[lower-alpha] space-y-2.5 pl-5 text-caption text-foreground-secondary">
                          <li>{t("detail.mercadoPagoWebhook.step1")}</li>
                          <li>
                            {t("detail.mercadoPagoWebhook.step2")}
                            <CodeField copyValue={webhookUrl} className="mt-2">
                              {webhookUrl}
                            </CodeField>
                          </li>
                          <li>
                            {t("detail.mercadoPagoWebhook.step3")}
                            <span className="mt-1 block break-words font-mono text-meta text-muted-foreground">
                              {MERCADO_PAGO_TOPICS.join(" · ")}
                            </span>
                          </li>
                          <li>{t("detail.mercadoPagoWebhook.step4")}</li>
                        </ol>
                        <div className="max-w-md">
                          {isAdmin ? <WebhookSecretForm workspaceSlug={workspaceSlug} integrationId={connection.id} /> : <InlineAlert>{t("detail.adminOnly")}</InlineAlert>}
                        </div>
                      </div>
                    ) : null}
                    {step === "verify" && current ? (
                      <p className="ml-6.5 mt-1 max-w-prose text-meta text-muted-foreground">{t("detail.mercadoPagoWebhook.verifyHint")}</p>
                    ) : null}
                  </li>
                )
              })}
            </ol>
          </section>
        ) : null}

        {/* An unfinished setup has no health to show yet: the setup itself comes first. */}
        {setupIncomplete ? null : (
          <section className="space-y-3">
            <SectionHeader title={t("detail.statusTitle")} className="mb-0" />
            <HealthStages health={connection.health} />
          </section>
        )}

        {connection.provider === "stripe" ? (
          <StripeSetup
            userId={user.id}
            workspaceId={workspace.id}
            workspaceSlug={workspaceSlug}
            integrationId={connection.id}
            isAdmin={isAdmin}
            relative={relative}
            evidence={{
              lastEventAt: connection.lastEventAt,
              lastEventType: connection.lastEventType,
              lastEventFailed: events[0]?.status === "failed",
              latest: {
                test: events.find((event) => event.environment === "test") ?? null,
                live: events.find((event) => event.environment === "live") ?? null,
              },
            }}
          />
        ) : null}

        <section className="space-y-3">
          <SectionHeader title={t("detail.paymentsTitle")} description={t("detail.paymentsDescription")} className="mb-0" />
          {payments.length === 0 ? (
            <p className="text-caption text-muted-foreground">{t("detail.paymentsEmpty", { provider: name })}</p>
          ) : (
            <ul className="divide-y divide-border-faint border-y border-border">
              {payments.map((payment) => (
                <li key={payment.transactionId} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-caption font-medium tabular-nums text-foreground">
                      {f.money(payment.grossAmountMinor, payment.currency)}
                    </span>
                    <span className="text-meta text-muted-foreground">{f.date(payment.occurredAt)}</span>
                    <span className="font-mono text-meta text-faint-foreground">{payment.providerTransactionId}</span>
                    <Badge
                      tone={payment.classification === "commissioned" ? "success" : payment.classification === "expected" ? "warning" : "neutral"}
                      className="ml-auto"
                    >
                      {t(`pipeline.classification.${payment.classification}`)}
                    </Badge>
                  </div>
                  <ol className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label={t("pipeline.label")}>
                    {PIPELINE.map((step) => {
                      const state = payment.steps[step]
                      // No referral is normal: an organic sale shows grey, never red.
                      const tone = payment.classification === "organic" && state === "missing" ? "neutral" : PIPELINE_TONE[state]
                      return (
                        <li key={step} className="flex items-center gap-1.5 text-meta text-muted-foreground">
                          <StatusDot tone={tone} />
                          {t(`pipeline.steps.${step}`)}
                          <span className="sr-only">{t(`pipeline.states.${state}`)}</span>
                        </li>
                      )
                    })}
                  </ol>
                  <PaymentExplanation
                    payment={payment}
                    provider={name}
                    identifyHref={{ pathname: "/[workspaceSlug]/integrations", params: { workspaceSlug }, query: { tab: "api" } }}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <details
          className="group rounded-panel border border-border"
          open={connection.health.issues.includes("processingFailed") || connection.health.issues.includes("environmentMismatch") ? true : undefined}
        >
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 px-4 py-3 marker:hidden [&::-webkit-details-marker]:hidden">
            <ChevronDown className="size-4 shrink-0 -rotate-90 text-muted-foreground transition-transform group-open:rotate-0" aria-hidden="true" />
            <span className="text-caption font-medium text-foreground">{t("detail.eventsTitle")}</span>
            <span className="text-meta text-muted-foreground">{t("detail.activityHint", { count: events.length })}</span>
          </summary>
          <div className="space-y-3 border-t border-border p-4">
            <p className="text-caption text-muted-foreground">{t("detail.eventsDescription")}</p>
            {events.length === 0 ? (
              <p className="text-caption text-muted-foreground">{t("detail.eventsEmpty")}</p>
            ) : (
              <ul className="divide-y divide-border-faint border-y border-border">
                {events.map((event, index) => (
                  <li key={`${event.providerEventId}-${index}`} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5">
                    <StatusDot tone={event.status === "failed" ? "danger" : event.status === "processed" ? "success" : "neutral"} className="mt-1.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-caption text-foreground-secondary">
                        {t(`detail.eventStatus.${event.status}`)}
                        {event.reasonCode ? <span className="text-muted-foreground"> — {t(`reasons.${event.reasonCode}`)}</span> : null}
                      </p>
                      <p className="break-all font-mono text-meta text-faint-foreground">{event.eventType}</p>
                    </div>
                    <span className="text-meta tabular-nums text-faint-foreground">{relative(event.receivedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>

        {descriptor ? (
          <details className="group rounded-panel border border-border">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 px-4 py-3 marker:hidden [&::-webkit-details-marker]:hidden">
            <ChevronDown className="size-4 shrink-0 -rotate-90 text-muted-foreground transition-transform group-open:rotate-0" aria-hidden="true" />
              <span className="text-caption font-medium text-foreground">{t("detail.capabilitiesTitle")}</span>
              <span className="text-meta text-muted-foreground">{t("detail.capabilitiesHint")}</span>
            </summary>
            <div className="space-y-3 border-t border-border p-4">
            <dl className="grid grid-cols-1 border-y border-border sm:grid-cols-2">
              {CAPABILITY_KEYS.map((key) => (
                <div key={key} className="flex items-center justify-between gap-4 border-b border-border-faint py-2.5 sm:odd:pr-4 sm:even:border-l sm:even:pl-4">
                  <dt className="text-caption text-muted-foreground">{t(`capabilities.${key}`)}</dt>
                  <dd className={cn("text-caption", descriptor.capabilities[key] ? "text-foreground" : "text-faint-foreground")}>
                    {descriptor.capabilities[key] ? t("capabilities.yes") : "—"}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="max-w-prose text-meta text-muted-foreground">{t(`detail.testStrategy.${descriptor.id}`)}</p>
            </div>
          </details>
        ) : null}

        <details className="group rounded-panel border border-border">
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 px-4 py-3 marker:hidden [&::-webkit-details-marker]:hidden">
            <ChevronDown className="size-4 shrink-0 -rotate-90 text-muted-foreground transition-transform group-open:rotate-0" aria-hidden="true" />
            <span className="text-caption font-medium text-foreground">{t("detail.advancedTitle")}</span>
            <span className="text-meta text-muted-foreground">{t("detail.advancedHint")}</span>
          </summary>
          <div className="space-y-5 border-t border-border p-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              <Advanced label={t("detail.fields.connectionId")} value={connection.id} />
              <Advanced label={t("detail.fields.accountId")} value={connection.providerAccountId ?? "—"} />
              <Advanced label={t("detail.fields.mode")} value={connection.mode ?? "—"} />
              <Advanced label={t("detail.fields.webhook")} value={connection.webhookRegistered ? t("detail.fields.webhookAuto") : t("detail.fields.webhookManual")} prose />
              <Advanced label={t("detail.fields.lastEvent")} value={connection.lastEventType ?? "—"} />
              <Advanced label={t("detail.fields.lastReason")} value={connection.lastReasonCode ? t(`reasons.${connection.lastReasonCode}`) : "—"} prose />
            </dl>
            {webhookUrl ? (
              <div className="space-y-1.5">
                <p className="text-meta text-muted-foreground">{t("detail.fields.endpoint")}</p>
                <CodeField copyValue={webhookUrl}>{webhookUrl}</CodeField>
              </div>
            ) : null}
            {isAdmin ? (
              <>
                <div className="max-w-xl">
                  <RenameForm workspaceSlug={workspaceSlug} integrationId={connection.id} current={connection.displayName} />
                </div>
                {apiProvider && !connection.health.issues.includes("authFailed") ? (
                  <div className="max-w-xl space-y-2">
                    <p className="text-caption font-medium text-foreground">{t("detail.rotateTitle")}</p>
                    <ReconnectForm workspaceSlug={workspaceSlug} integrationId={connection.id} provider={apiProvider} providerName={name} />
                  </div>
                ) : null}
                <div className="space-y-2 border-t border-border pt-4">
                  <p className="max-w-prose text-meta text-muted-foreground">{t("detail.disconnectHint")}</p>
                  <DisconnectConnection workspaceSlug={workspaceSlug} integrationId={connection.id} label={label} />
                </div>
              </>
            ) : (
              <InlineAlert>{t("detail.adminOnly")}</InlineAlert>
            )}
          </div>
        </details>
      </div>
    </>
  )
}

function Advanced({ label, value, prose = false }: { label: string; value: string; prose?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 text-meta text-foreground-secondary", prose ? "text-pretty" : "truncate font-mono")}>{value}</dd>
    </div>
  )
}

/**
 * Stripe's own setup — account id, endpoint secrets per mode, or Connect —
 * reused as it is, scoped to this connection.
 */
async function StripeSetup({
  userId,
  workspaceId,
  workspaceSlug,
  integrationId,
  isAdmin,
  relative,
  evidence: own,
}: {
  userId: string
  workspaceId: string
  workspaceSlug: string
  integrationId: string
  isAdmin: boolean
  relative: (value: Date | null) => string | null
  /** This connection's own events — a workspace may also receive other providers' events. */
  evidence: {
    lastEventAt: Date | null
    lastEventType: string | null
    lastEventFailed: boolean
    latest: Record<"test" | "live", { receivedAt: Date; eventType: string; status: string } | null>
  }
}) {
  const [setup, health, keys] = await Promise.all([
    getStripeSetup(userId, workspaceId, integrationId),
    getIntegrationHealth(userId, workspaceId),
    isAdmin ? listApiKeys(userId, workspaceId) : Promise.resolve(null),
  ])
  const appUrl = appOrigin().origin
  const state = deriveStripeState({
    integration: setup,
    lastEventAt: own.lastEventAt,
    lastEventFailed: own.lastEventFailed,
  })
  const evidence = (environment: "test" | "live") => {
    const line = own.latest[environment]
    return { when: relative(line?.receivedAt ?? null), type: line?.eventType ?? null, failed: line?.status === "failed", exact: true }
  }
  const attribution = (environment: "test" | "live") => {
    const value = health.attribution[environment]
    return { issue: attributionIssue(value), payments: value.payments, paymentsWithoutCustomer: value.paymentsWithoutCustomer }
  }
  const lastEventWhen = relative(own.lastEventAt)

  return (
    <StripePanel
      workspaceSlug={workspaceSlug}
      integrationId={integrationId}
      state={state}
      providerAccountId={setup?.providerAccountId ?? null}
      secrets={setup?.secrets ?? { test: false, live: false }}
      environments={{ test: evidence("test"), live: evidence("live") }}
      liveModeAvailable={keys?.liveModeAvailable ?? true}
      webhookUrl={setup ? new URL(stripeWebhookPath(setup.integrationId), appUrl).toString() : null}
      lastEvent={lastEventWhen && own.lastEventType ? { when: lastEventWhen, type: own.lastEventType } : null}
      lastRejectedWhen={relative(setup?.lastRejectedAt ?? null)}
      readOnly={!isAdmin}
      attribution={{ test: attribution("test"), live: attribution("live") }}
      attributionDays={ATTRIBUTION_WINDOW_DAYS}
      connectUrl={isAdmin && stripeConnectAvailable() ? `/api/integrations/stripe/oauth?workspace=${encodeURIComponent(workspaceSlug)}` : null}
    />
  )
}

/**
 * One sentence under a payment's pipeline: the first step that explains it,
 * with the fix when there is one. An organic sale says so and alarms no one.
 */
async function PaymentExplanation({
  payment,
  provider,
  identifyHref,
}: {
  payment: PaymentDiagnosis
  provider: string
  identifyHref: React.ComponentProps<typeof Link>["href"]
}) {
  const t = await getTranslations("dashboard.integrations.pipeline")
  if (payment.classification === "commissioned") return null
  if (payment.classification === "organic") {
    return <p className="text-meta text-muted-foreground">{t("explain.organic")}</p>
  }
  const step = EXPLAINED.find((key) => payment.steps[key] === "missing") ?? "commission"
  return (
    <p className="text-meta text-foreground-secondary">
      {t(`explain.${step}`, { provider })}
      {step === "billingIdentity" ? (
        <>
          {" "}
          <Link href={identifyHref} className="underline underline-offset-4 hover:text-foreground">
            {t("cta.identify")}
          </Link>
        </>
      ) : null}
    </p>
  )
}
