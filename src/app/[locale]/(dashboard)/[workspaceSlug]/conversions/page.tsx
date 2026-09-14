import { ArrowRight, Receipt } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { Link } from "@/i18n/navigation"

import { EmptyState } from "@/components/feedback/empty-state"
import { getFormatters } from "@/i18n/format"
import { PageHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { getRecentConversions } from "@/server/repositories/analytics"
import { listIntegrations } from "@/server/services/integrations"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/[workspaceSlug]/conversions">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.conversions" })
  return { title: t("title") }
}

/** The read returns the most recent rows only; there is no total to show. */
const LIMIT = 100

export default async function ConversionsPage({
  params,
}: PageProps<"/[locale]/[workspaceSlug]/conversions">) {
  const t = await getTranslations("dashboard.conversions")
  const tc = await getTranslations("common.table")
  const ta = await getTranslations("common.actions")
  const f = await getFormatters()
  const { workspaceSlug } = await params
  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)

  const [conversions, integrations] = await withUser(user.id, (tx) =>
    Promise.all([getRecentConversions(tx, workspace.id, LIMIT), listIntegrations(tx, workspace.id)]),
  )

  const capped = conversions.length >= LIMIT
  const billingConnected = integrations.some((integration) => integration.status === "connected")
  const integrationsHref = { pathname: "/[workspaceSlug]/integrations", params: { workspaceSlug } } as const

  return (
    <>
      <PageHeader
        title={t("title")}
        meta={
          conversions.length === 0
            ? undefined
            : capped
              ? t("latest", { count: LIMIT })
              : f.number(conversions.length)
        }
        description={t("description")}
      />

      {conversions.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={t("empty.title")}
          description={billingConnected ? t("empty.descriptionConnected") : t("empty.description")}
          action={
            // Only offer to connect billing when it is not connected yet.
            billingConnected ? (
              <Button asChild variant="secondary">
                <Link href={integrationsHref}>{ta("viewIntegrations")}</Link>
              </Button>
            ) : (
              <Button asChild variant="primary">
                <Link href={integrationsHref}>{ta("connectBilling")}</Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <TableContainer scrollable>
            <Table className="min-w-3xl">
              <THead>
                <tr>
                  <TH>{tc("date")}</TH>
                  <TH>{tc("affiliate")}</TH>
                  <TH>{tc("customer")}</TH>
                  <TH numeric>{tc("payment")}</TH>
                  <TH numeric>{tc("commission")}</TH>
                  <TH>{tc("status")}</TH>
                </tr>
              </THead>
              <TBody>
                {conversions.map((conversion) => (
                  <TR key={conversion.id}>
                    <TD className="whitespace-nowrap text-muted-foreground">
                      {f.date(conversion.occurredAt)}
                    </TD>
                    <TD className="whitespace-nowrap text-foreground">{conversion.affiliateName}</TD>
                    <TD mono>{conversion.customerRef}</TD>
                    <TD numeric>{f.money(conversion.amountMinor, conversion.currency)}</TD>
                    <TD numeric className="text-foreground">
                      {f.money(conversion.commissionMinor, conversion.currency)}
                    </TD>
                    <TD>
                      <StatusBadge status={conversion.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>

          {capped ? (
            <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-meta text-muted-foreground">
              <span>{t("capped", { count: LIMIT })}</span>
              <Button asChild variant="ghost" size="sm">
                <Link href={{ pathname: "/[workspaceSlug]/commissions", params: { workspaceSlug } }}>
                  {t("viewCommissions")}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </div>
          ) : null}
        </>
      )}
    </>
  )
}
