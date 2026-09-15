import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

import { InlineAlert } from "@/components/feedback/inline-alert"
import { PageHeader, SectionHeader } from "@/components/layout/page-header"
import { stripeWebhookPath } from "@/lib/billing/stripe/events"
import { TRACKER_PATH } from "@/lib/tracking/constants"
import { ApiKeysPanel } from "@/features/integrations/api-keys-panel"
import { StripePanel } from "@/features/integrations/stripe-panel"
import { deriveStripeState, formatRelativeTime } from "@/features/integrations/stripe-status"
import { requireUser } from "@/server/auth/session"
import { canManageApiKeys, listApiKeys } from "@/server/services/api-keys"
import { getIntegrationHealth } from "@/server/services/integration-health"
import { getStripeSetup } from "@/server/services/integrations"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/[workspaceSlug]/integrations">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.integrations" })
  return { title: t("title") }
}

export default async function IntegrationsPage({
  params,
}: PageProps<"/[locale]/[workspaceSlug]/integrations">) {
  const t = await getTranslations("dashboard.integrations")
  const tk = await getTranslations("forms.apiKeys")
  const locale = await getLocale()
  const { workspaceSlug } = await params
  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)

  // API keys are admin-only (`listApiKeys` enforces it). A `member` gets the
  // integration status read-only, and the admin-only reads are never called.
  const isAdmin = canManageApiKeys(workspace.role)

  const [setup, health, keys] = await Promise.all([
    getStripeSetup(user.id, workspace.id),
    getIntegrationHealth(user.id, workspace.id),
    isAdmin ? listApiKeys(user.id, workspace.id) : Promise.resolve(null),
  ])

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  const now = new Date()
  const relative = (value: Date | null) => (value ? formatRelativeTime(locale, value, now) : null)

  const state = deriveStripeState({
    integration: setup,
    lastEventAt: health.stripe.lastEventAt,
    lastEventFailed: health.stripe.lastEventFailed,
  })
  const lastEventWhen = relative(health.stripe.lastEventAt)
  const evidence = (environment: "test" | "live") => {
    const line = health.stripe.environments[environment]
    return {
      when: relative(line.lastEventAt),
      type: line.lastEventType,
      failed: line.lastEventFailed,
      exact: line.exact,
    }
  }
  const lastClickWhen = relative(health.tracking.lastClickAt)

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />

      {/* The shell caps direct children at the content width; these sections
          read better narrower, left-aligned with the description above. */}
      <div>
        <div className="max-w-detail space-y-10">
          <StripePanel
            workspaceSlug={workspaceSlug}
            state={state}
            providerAccountId={setup?.providerAccountId ?? null}
            secrets={setup?.secrets ?? { test: false, live: false }}
            environments={{ test: evidence("test"), live: evidence("live") }}
            // Only admins see the secret forms, and only admins load keys.
            liveModeAvailable={keys?.liveModeAvailable ?? true}
            webhookUrl={setup ? `${appUrl}${stripeWebhookPath(setup.integrationId)}` : null}
            lastEvent={
              lastEventWhen && health.stripe.lastEventType
                ? { when: lastEventWhen, type: health.stripe.lastEventType }
                : null
            }
            lastRejectedWhen={relative(setup?.lastRejectedAt ?? null)}
            readOnly={!isAdmin}
          />

          {keys ? (
            // Only a key prefix is stored, so the panel builds the tracking code
            // itself — complete only right after a key is generated.
            <ApiKeysPanel
              workspaceSlug={workspaceSlug}
              keys={keys.keys}
              liveModeAvailable={keys.liveModeAvailable}
              trackerUrl={`${appUrl}${TRACKER_PATH}`}
              lastClickWhen={lastClickWhen}
            />
          ) : (
            <>
              <section>
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
      </div>
    </>
  )
}
