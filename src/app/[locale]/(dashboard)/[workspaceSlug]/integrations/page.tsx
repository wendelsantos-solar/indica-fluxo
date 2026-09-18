import { AlertCircle, ArrowRight, ArrowUpRight, CheckCircle2, ChevronDown, Circle, CircleDashed, CreditCard } from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

import { EmptyState } from "@/components/feedback/empty-state"
import { InlineAlert } from "@/components/feedback/inline-alert"
import { PageHeader, SectionHeader } from "@/components/layout/page-header"
import { Badge, StatusDot } from "@/components/ui/badge"
import { AddProviderDialog, type ProviderOption } from "@/features/integrations/add-provider-dialog"
import { ApiKeysPanel } from "@/features/integrations/api-keys-panel"
import { AutoRefresh } from "@/features/integrations/auto-refresh"
import { CheckoutBridgeSection } from "@/features/integrations/checkout-bridge-section"
import { ConnectionCard, ConnectionRow, type ConnectionCardData } from "@/features/integrations/connection-card"
import { connectionDisplayState, connectionPresence, workspaceStatus, type WorkspaceStatus } from "@/features/integrations/health"
import { IdentifySection } from "@/features/integrations/identify-section"
import { IntegrationTabs, integrationTab } from "@/features/integrations/integration-tabs"
import { ProviderSelection } from "@/features/integrations/provider-selection"
import { providerName } from "@/features/integrations/provider-mark"
import { deriveSetup } from "@/features/integrations/setup"
import { formatRelativeTime } from "@/features/integrations/stripe-status"
import { sectionAnchor } from "@/features/docs/structure"
import { Link } from "@/i18n/navigation"
import type { Locale } from "@/i18n/routing"
import { CONNECTOR_IDS, isConnectorId, type ConnectorId } from "@/lib/billing/catalog"
import { TRACKER_PATH } from "@/lib/tracking/constants"
import { appUrl as appOrigin } from "@/lib/site"
import { cn } from "@/lib/utils"
import { requireUser } from "@/server/auth/session"
import { canManageApiKeys, listApiKeys } from "@/server/services/api-keys"
import { getIntegrationOverview, type ConnectionSummary } from "@/server/services/connection-health"
import { getIntegrationHealth } from "@/server/services/integration-health"
import { stripeConnectAvailable } from "@/server/services/stripe-connect"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/[workspaceSlug]/integrations">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.integrations" })
  return { title: t("title") }
}

/**
 * Integrations — "integrate once, connect every provider you charge through"
 * (UNIVERSAL_ATTRIBUTION_ARCHITECTURE.md, MULTI_PROVIDER_UX_SPEC.md).
 *
 *   Overview  what works, what is missing, and the setup in order
 *   Payments  one card per provider account; add, open, fix
 *   Tracking  the tracker tag and its keys
 *   API       identify, the checkout bridge
 *
 * A `member` reads everything; connecting, disconnecting and keys are admin
 * actions (the services enforce it — the UI only hides what would be refused).
 */
export default async function IntegrationsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/[workspaceSlug]/integrations">) {
  const t = await getTranslations("dashboard.integrations")
  const locale = await getLocale()
  const { workspaceSlug } = await params
  const tab = integrationTab((await searchParams).tab)
  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)
  const isAdmin = canManageApiKeys(workspace.role)

  const overview = await getIntegrationOverview(user.id, workspace.id)
  const now = new Date()
  const relative = (value: Date | null) => (value ? formatRelativeTime(locale, value, now) : null)
  const appUrl = appOrigin().origin

  // A real disconnect and a never-stored key leave the lists; a manual setup
  // started and not finished stays, as "Configuração incompleta" (connectionPresence).
  const connections = overview.connections.filter((connection) => connectionPresence(connection) !== "hidden")
  const cards: ConnectionCardData[] = connections.map((connection) => cardData(connection, relative, overview.availability))
  const identityDetected = Boolean(overview.identity.lastIdentifyAt || overview.identity.lastReferenceBoundAt)
  const setup = deriveSetup({
    trackerDetected: overview.tracker.lastClickAt !== null,
    identityDetected,
    selection: overview.selection,
    connections: connections.map((connection) => ({
      provider: connection.provider,
      overall: connection.health.overall,
      events: connection.events,
      payments: connection.payments,
      incomplete: connectionPresence(connection) === "setupIncomplete",
      id: connection.id,
    })),
  })
  const panelPending = connections.some((connection) => connection.provider === "mercado_pago" && connection.status === "pending")
  const status = workspaceStatus({
    trackerDetected: overview.tracker.lastClickAt !== null,
    identityDetected,
    states: cards.map((card) => card.state),
  })
  const selected = overview.selection ?? [...new Set(connections.map((connection) => connection.provider).filter(isConnectorId))]
  const stripeConnectUrl =
    isAdmin && stripeConnectAvailable() ? `/api/integrations/stripe/oauth?workspace=${encodeURIComponent(workspaceSlug)}` : null
  const providerOptions: ProviderOption[] = CONNECTOR_IDS.map((id) => ({
    id,
    availability: overview.availability[id],
    connected: connections.filter((connection) => connection.provider === id).length,
    incomplete: connections
      .filter((connection) => connection.provider === id && connectionPresence(connection) === "setupIncomplete")
      .map((connection) => ({
        id: connection.id,
        label: connection.displayName ? `${providerName(id)} — ${connection.displayName}` : providerName(id),
      })),
  }))
  const addProvider = isAdmin ? (
    <AddProviderDialog workspaceSlug={workspaceSlug} providers={providerOptions} stripeConnectUrl={stripeConnectUrl} />
  ) : null

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={tab === "payments" ? addProvider : undefined}
      />
      <IntegrationTabs workspaceSlug={workspaceSlug} current={tab} counts={{ payments: connections.length }} />

      {tab === "overview" ? (
        <div className="space-y-10">
          <AutoRefresh active={setup.waiting} />
          <SummaryStrip
            trackerWhen={relative(overview.tracker.lastClickAt)}
            identityWhen={relative(overview.identity.lastIdentifyAt ?? overview.identity.lastReferenceBoundAt)}
            providers={new Set(connections.map((connection) => connection.provider)).size}
            accounts={connections.length}
            status={status}
          />

          {setup.ready ? (
            <InlineAlert tone="success" title={t("setup.readyTitle")}>
              {t("setup.readyHint")}
            </InlineAlert>
          ) : null}

          <section className="space-y-3">
            <SectionHeader
              title={t("overview.connectionsTitle")}
              count={connections.length || undefined}
              action={
                cards.length ? (
                  <Link
                    href={{ pathname: "/[workspaceSlug]/integrations", params: { workspaceSlug }, query: { tab: "payments" } }}
                    className="inline-flex items-center gap-1 text-caption text-foreground-secondary hover:text-foreground"
                  >
                    {t("overview.manage")}
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Link>
                ) : (
                  addProvider ?? undefined
                )
              }
              className="mb-0"
            />
            {cards.length ? (
              <ul className="divide-y divide-border-faint border-y border-border">
                {cards.map((card) => (
                  <ConnectionRow key={card.id} connection={card} workspaceSlug={workspaceSlug} />
                ))}
              </ul>
            ) : (
              <p className="text-caption text-muted-foreground">{t("payments.emptyBody")}</p>
            )}
          </section>

          {!setup.ready ? (
            <SetupChecklist setup={setup} workspaceSlug={workspaceSlug} panelPending={panelPending} />
          ) : null}

          <details
            className="group rounded-panel border border-border"
            open={overview.selection === null && connections.length === 0 ? true : undefined}
          >
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-0.5 px-4 py-3 marker:hidden [&::-webkit-details-marker]:hidden">
              <ChevronDown className="size-4 shrink-0 -rotate-90 text-muted-foreground transition-transform group-open:rotate-0" aria-hidden="true" />
              <span className="text-caption font-medium text-foreground">{t("overview.selectionTitle")}</span>
              <span className="text-meta text-muted-foreground">
                {t("overview.selectionSummary", { count: selected.length + (overview.selectionOther ? 1 : 0) })}
              </span>
            </summary>
            <div className="border-t border-border p-4">
              <ProviderSelection
                workspaceSlug={workspaceSlug}
                availability={overview.availability}
                selected={selected}
                other={overview.selectionOther}
                readOnly={!isAdmin}
              />
            </div>
          </details>

          {setup.ready ? <SetupChecklist setup={setup} workspaceSlug={workspaceSlug} panelPending={panelPending} /> : null}

          <section className="space-y-3">
            <SectionHeader title={t("test.title")} description={t("test.description")} className="mb-0" />
            <ol className="max-w-prose list-decimal space-y-1 pl-5 text-caption text-muted-foreground">
              <li>{t("test.step1")}</li>
              <li>{t("test.step2")}</li>
              <li>{t("test.step3")}</li>
            </ol>
            <p className="text-caption text-muted-foreground">
              {t.rich("test.simulate", {
                link: (chunks) => (
                  <Link href={{ pathname: "/[workspaceSlug]/programs", params: { workspaceSlug } }} className="text-foreground-secondary underline underline-offset-4 hover:text-foreground">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </section>
        </div>
      ) : null}

      {tab === "payments" ? (
        <div className="space-y-8">
          {cards.length === 0 ? (
            <EmptyState icon={CreditCard} title={t("payments.emptyTitle")} description={t("payments.emptyBody")} action={addProvider ?? undefined} />
          ) : (
            groupByProvider(cards).map(([provider, group]) => (
              <section key={provider} className="space-y-3">
                <SectionHeader
                  title={providerName(provider)}
                  count={group.length > 1 ? t("payments.accounts", { count: group.length }) : undefined}
                  action={
                    isAdmin && isConnectorId(provider) && overview.availability[provider] !== "coming_soon" ? (
                      <AddProviderDialog
                        workspaceSlug={workspaceSlug}
                        providers={providerOptions}
                        stripeConnectUrl={stripeConnectUrl}
                        initialProvider={provider}
                        triggerLabel={t("payments.addAnother")}
                        triggerVariant="ghost"
                      />
                    ) : undefined
                  }
                  className="mb-0"
                />
                <div className="grid gap-3 md:grid-cols-2">
                  {group.map((card) => (
                    <ConnectionCard key={card.id} connection={card} workspaceSlug={workspaceSlug} />
                  ))}
                </div>
              </section>
            ))
          )}
          {!isAdmin ? <InlineAlert>{t("payments.memberNotice")}</InlineAlert> : null}
        </div>
      ) : null}

      {tab === "tracking" ? <TrackingTab userId={user.id} workspaceId={workspace.id} workspaceSlug={workspaceSlug} isAdmin={isAdmin} relative={relative} appUrl={appUrl} /> : null}

      {tab === "api" ? (
        <div className="space-y-10">
          <ApiIdentify userId={user.id} workspaceId={workspace.id} relative={relative} appUrl={appUrl} />
          <CheckoutBridgeSection
            availability={overview.availability}
            providers={[...new Set(connections.map((connection) => connection.provider).filter(isConnectorId))] as ConnectorId[]}
          />
          <ApiMore />
        </div>
      ) : null}
    </>
  )
}

function cardData(
  connection: ConnectionSummary,
  relative: (value: Date | null) => string | null,
  availability: Record<ConnectorId, "public" | "beta" | "coming_soon">,
): ConnectionCardData {
  return {
    id: connection.id,
    provider: connection.provider,
    displayName: connection.displayName,
    environment: connection.environment,
    health: connection.health,
    state: connectionDisplayState(connection.health, connection.status, connectionPresence(connection)),
    lastEventWhen: relative(connection.lastEventAt),
    beta: isConnectorId(connection.provider) && availability[connection.provider] === "beta",
    pendingPanelStep: connection.provider === "mercado_pago" && connection.status === "pending",
    setupIncomplete: connectionPresence(connection) === "setupIncomplete",
  }
}

function groupByProvider(cards: ConnectionCardData[]): Array<[string, ConnectionCardData[]]> {
  const groups = new Map<string, ConnectionCardData[]>()
  for (const card of cards) groups.set(card.provider, [...(groups.get(card.provider) ?? []), card])
  return [...groups.entries()]
}

async function SummaryStrip({
  trackerWhen,
  identityWhen,
  providers,
  accounts,
  status,
}: {
  trackerWhen: string | null
  identityWhen: string | null
  providers: number
  accounts: number
  status: WorkspaceStatus
}) {
  const t = await getTranslations("dashboard.integrations.summary")
  const items: Array<{ label: string; value: string; tone: "success" | "warning" | "danger" | "neutral" | null }> = [
    { label: t("tracker"), value: trackerWhen ? t("detected", { when: trackerWhen }) : t("waiting"), tone: trackerWhen ? "success" : "neutral" },
    { label: t("identity"), value: identityWhen ? t("detected", { when: identityWhen }) : t("waiting"), tone: identityWhen ? "success" : "neutral" },
    // A count, not a health claim: no dot (brief §11).
    { label: t("providers"), value: t("providersValue", { count: providers, accounts: accounts > providers ? accounts : 0 }), tone: null },
    { label: t("health"), value: t(`status.${status.key}`, { count: status.key === "attention" ? status.count : 0 }), tone: status.tone },
  ]
  return (
    <section aria-label={t("title")}>
      <dl className="grid grid-cols-2 border-y border-border md:grid-cols-4">
        {items.map((item, index) => (
          <div
            key={item.label}
            className={cn(
              "min-w-0 py-3.5 pr-4",
              index % 2 === 1 && "pl-4 max-md:border-l max-md:border-border",
              index > 0 && "md:border-l md:border-border md:pl-4",
              index > 1 && "max-md:border-t max-md:border-border",
            )}
          >
            <dt className="truncate text-meta text-muted-foreground">{item.label}</dt>
            <dd className="mt-1 flex items-center gap-2 text-caption font-medium text-foreground">
              {item.tone ? <StatusDot tone={item.tone} /> : null}
              <span className="min-w-0">{item.value}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** The setup, in order; each step ticks itself from evidence (`deriveSetup`). */
async function SetupChecklist({
  setup,
  workspaceSlug,
  panelPending = false,
}: {
  setup: ReturnType<typeof deriveSetup>
  workspaceSlug: string
  /** A Mercado Pago connection still needs its panel step: say that, not "waiting". */
  panelPending?: boolean
}) {
  const t = await getTranslations("dashboard.integrations")
  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("setup.title")}
        count={t("setup.progress", { done: setup.done, total: setup.total })}
        description={setup.ready ? t("setup.readyBody") : t("setup.description")}
        className="mb-0"
      />
      <ol className="divide-y divide-border-faint border-y border-border">
        {setup.steps.map((step, index) => (
          <li key={`${step.key}-${step.provider ?? index}`} className="flex items-start gap-3 py-3">
            {step.done ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-foreground" aria-hidden="true" />
            ) : step.state === "attention" ? (
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger-foreground" aria-hidden="true" />
            ) : step.state === "waiting" || step.state === "incomplete" ? (
              <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : (
              <Circle className="mt-0.5 size-4 shrink-0 text-faint-foreground" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-caption text-foreground">
                <span className={cn(step.done && "text-foreground-secondary")}>
                  {step.key === "connect" && step.provider
                    ? t("setup.steps.connectProvider", { provider: providerName(step.provider) })
                    : t(`setup.steps.${step.key}`)}
                </span>
                <span className="sr-only">{step.done ? t("setup.done") : t("setup.pending")}</span>
                {step.optional && !step.done ? <Badge dot={false}>{t("setup.optional")}</Badge> : null}
              </p>
              {!step.done ? (
                <p className="mt-0.5 text-meta text-muted-foreground">
                  {step.state === "incomplete"
                    ? t("setup.hints.connectIncomplete")
                    : step.state === "waiting" && step.provider === "mercado_pago" && panelPending
                    ? t("setup.hints.connectPanel")
                    : step.state === "waiting"
                    ? t("setup.hints.connectWaiting")
                    : step.state === "attention"
                      ? t("setup.hints.connectAttention")
                      : t(`setup.hints.${step.key}`)}{" "}
                  <SetupLink
                    step={step.key}
                    workspaceSlug={workspaceSlug}
                    provider={step.provider}
                    opened={Boolean(step.state)}
                    resumeConnectionId={step.connectionId}
                  />
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

async function SetupLink({
  step,
  workspaceSlug,
  provider,
  opened = false,
  resumeConnectionId,
}: {
  step: "tracker" | "identity" | "choose" | "connect" | "test"
  workspaceSlug: string
  provider?: ConnectorId
  /** A connection already exists: the link opens it rather than connecting another. */
  opened?: boolean
  /** A manual setup left halfway: resume it where it stopped. */
  resumeConnectionId?: string
}) {
  const t = await getTranslations("dashboard.integrations.setup.links")
  const query: Record<string, string> =
    step === "tracker" ? { tab: "tracking" } : step === "identity" ? { tab: "api" } : step === "connect" || step === "test" ? { tab: "payments" } : {}
  if (step === "choose") return null
  if (resumeConnectionId) {
    return (
      <Link
        href={{ pathname: "/[workspaceSlug]/integrations/[connectionId]", params: { workspaceSlug, connectionId: resumeConnectionId } }}
        className="text-foreground-secondary underline underline-offset-4 hover:text-foreground"
      >
        {t("resume")}
      </Link>
    )
  }
  return (
    <Link
      href={{ pathname: "/[workspaceSlug]/integrations", params: { workspaceSlug }, query }}
      className="text-foreground-secondary underline underline-offset-4 hover:text-foreground"
    >
      {provider && step === "connect"
        ? t(opened ? "open" : "connectProvider", { provider: providerName(provider) })
        : t(step)}
    </Link>
  )
}

async function TrackingTab({
  userId,
  workspaceId,
  workspaceSlug,
  isAdmin,
  relative,
  appUrl,
}: {
  userId: string
  workspaceId: string
  workspaceSlug: string
  isAdmin: boolean
  relative: (value: Date | null) => string | null
  appUrl: string
}) {
  const tk = await getTranslations("forms.apiKeys")
  const t = await getTranslations("dashboard.integrations.tracking")
  const [keys, health] = await Promise.all([
    isAdmin ? listApiKeys(userId, workspaceId) : Promise.resolve(null),
    getIntegrationHealth(userId, workspaceId),
  ])
  const lastClickWhen = relative(health.tracking.lastClickAt)
  const absolute = (path: string) => new URL(path, appUrl).toString()

  const lastIdentify = [health.attribution.test.lastIdentifyAt, health.attribution.live.lastIdentifyAt]
    .filter((value): value is Date => value !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null
  const identifyWhen = relative(lastIdentify)

  return (
    <div className="space-y-10">
      <AutoRefresh active={!health.tracking.lastClickAt || !lastIdentify} />
      <section className="space-y-3">
        <SectionHeader title={t("statusTitle")} description={t("explainer")} className="mb-0" />
        <dl className="grid border-y border-border sm:grid-cols-2">
          {[
            { label: t("tracker"), when: lastClickWhen, waiting: t("waitingTracker") },
            { label: t("identity"), when: identifyWhen, waiting: t("waitingIdentity") },
          ].map((item, index) => (
            <div key={item.label} className={cn("min-w-0 py-3", index === 1 && "max-sm:border-t max-sm:border-border sm:border-l sm:border-border sm:pl-4")}>
              <dt className="text-caption text-muted-foreground">{item.label}</dt>
              <dd className="mt-1 flex items-start gap-2 text-caption text-foreground">
                <StatusDot tone={item.when ? "success" : "neutral"} className="mt-1.5" />
                <span className="min-w-0">{item.when ? t("working", { when: item.when }) : item.waiting}</span>
              </dd>
            </div>
          ))}
        </dl>
        {!identifyWhen ? (
          <Link
            href={{ pathname: "/[workspaceSlug]/integrations", params: { workspaceSlug }, query: { tab: "api" } }}
            className="inline-flex items-center gap-1 text-caption text-foreground-secondary underline underline-offset-4 hover:text-foreground"
          >
            {t("identityHow")}
          </Link>
        ) : null}
      </section>
      {keys ? (
        <ApiKeysPanel
          workspaceSlug={workspaceSlug}
          keys={keys.keys}
          liveModeAvailable={keys.liveModeAvailable}
          trackerUrl={absolute(TRACKER_PATH)}
          lastClickWhen={lastClickWhen}
        />
      ) : (
        <>
          <section id="api-keys" className="scroll-mt-16">
            <SectionHeader title={tk("title")} className="mb-3" />
            <InlineAlert>{tk("adminOnly")}</InlineAlert>
          </section>
          <section id="tracking" className="scroll-mt-16">
            <SectionHeader title={tk("snippet")} className="mb-3" />
            <p className="text-meta text-muted-foreground">
              {lastClickWhen ? tk("lastClick", { when: lastClickWhen }) : tk("noClicks")}
            </p>
          </section>
        </>
      )}
    </div>
  )
}

async function ApiIdentify({
  userId,
  workspaceId,
  relative,
  appUrl,
}: {
  userId: string
  workspaceId: string
  relative: (value: Date | null) => string | null
  appUrl: string
}) {
  const health = await getIntegrationHealth(userId, workspaceId)
  return (
    <IdentifySection
      appOrigin={new URL(appUrl).origin}
      lastIdentified={{
        test: relative(health.attribution.test.lastIdentifyAt),
        live: relative(health.attribution.live.lastIdentifyAt),
      }}
    />
  )
}

/**
 * The API tab reads by use case (brief §23): identify, then the checkout
 * reference, then what only some integrations need — pointers into the guide,
 * not a second copy of it.
 */
async function ApiMore() {
  const t = await getTranslations("dashboard.integrations.apiMore")
  const locale = (await getLocale()) as Locale
  const links = [
    { key: "advanced", hash: sectionAnchor("guestCheckout", locale) },
    { key: "errors", hash: sectionAnchor("errors", locale) },
    { key: "diagnostics", hash: sectionAnchor("missingCommission", locale) },
  ] as const
  return (
    <section className="space-y-3">
      <SectionHeader title={t("title")} description={t("description")} className="mb-0" />
      <ul className="divide-y divide-border-faint border-y border-border">
        {links.map((link) => (
          <li key={link.key}>
            <Link
              href={{ pathname: "/docs", hash: link.hash }}
              className="group flex items-start gap-3 py-3 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            >
              <div className="min-w-0 flex-1">
                <p className="text-caption font-medium text-foreground">{t(link.key)}</p>
                <p className="mt-0.5 text-meta text-muted-foreground">{t(`${link.key}Hint`)}</p>
              </div>
              <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-faint-foreground group-hover:text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
