import type { Metadata } from "next"

import { PageHeader } from "@/components/layout/page-header"
import { TRACKER_PATH } from "@/lib/tracking/constants"
import { ApiKeysPanel } from "@/features/integrations/api-keys-panel"
import { StripePanel } from "@/features/integrations/stripe-panel"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listApiKeys } from "@/server/services/api-keys"
import { listIntegrations } from "@/server/services/integrations"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const metadata: Metadata = { title: "Integrations" }
export const dynamic = "force-dynamic"

export default async function IntegrationsPage({
  params,
}: PageProps<"/[workspaceSlug]/integrations">) {
  const { workspaceSlug } = await params
  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)

  const [integrations, keys] = await Promise.all([
    withUser(user.id, (tx) => listIntegrations(tx, workspace.id)),
    listApiKeys(user.id, workspace.id),
  ])

  const stripe = integrations.find((integration) => integration.provider === "stripe") ?? null
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  const publishable = keys.find((key) => key.type === "publishable" && !key.revokedAt)

  const snippet = `<script defer src="${appUrl}${TRACKER_PATH}" data-key="${publishable?.keyPrefix ?? "pk_live_…"}…"></script>`

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Integrations"
        description="Connect the billing provider that charges your customers, then install tracking."
      />

      <div className="space-y-6">
        <StripePanel
          workspaceSlug={workspaceSlug}
          status={stripe?.status ?? null}
          providerAccountId={stripe?.providerAccountId ?? null}
          webhookUrl={`${appUrl}/api/webhooks/stripe`}
        />

        <ApiKeysPanel workspaceSlug={workspaceSlug} keys={keys} snippet={snippet} />
      </div>
    </div>
  )
}
