import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { InlineAlert } from "@/components/feedback/inline-alert"
import { PageHeader, SectionHeader } from "@/components/layout/page-header"
import { TRACKER_PATH } from "@/lib/tracking/constants"
import { ApiKeysPanel } from "@/features/integrations/api-keys-panel"
import { StripePanel } from "@/features/integrations/stripe-panel"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { canManageApiKeys, listApiKeys } from "@/server/services/api-keys"
import { listIntegrations } from "@/server/services/integrations"
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
  const { workspaceSlug } = await params
  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)

  // API keys are admin-only (`listApiKeys` enforces it). A `member` gets the
  // integration status read-only, and the admin-only reads are never called.
  const isAdmin = canManageApiKeys(workspace.role)

  const [integrations, keys] = await Promise.all([
    withUser(user.id, (tx) => listIntegrations(tx, workspace.id)),
    isAdmin ? listApiKeys(user.id, workspace.id) : Promise.resolve(null),
  ])

  const stripe = integrations.find((integration) => integration.provider === "stripe") ?? null
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />

      {/* The shell caps direct children at the content width; these sections
          read better narrower, left-aligned with the description above. */}
      <div>
        <div className="max-w-detail space-y-10">
          <StripePanel
            workspaceSlug={workspaceSlug}
            status={stripe?.status ?? null}
            providerAccountId={stripe?.providerAccountId ?? null}
            webhookUrl={`${appUrl}/api/webhooks/stripe`}
            readOnly={!isAdmin}
          />

          {keys ? (
            // Only a key prefix is stored, so the panel builds the tracking code
            // itself — complete only right after a key is generated.
            <ApiKeysPanel
              workspaceSlug={workspaceSlug}
              keys={keys}
              trackerUrl={`${appUrl}${TRACKER_PATH}`}
            />
          ) : (
            <section>
              <SectionHeader title={tk("title")} className="mb-3" />
              <InlineAlert>{tk("adminOnly")}</InlineAlert>
            </section>
          )}
        </div>
      </div>
    </>
  )
}
