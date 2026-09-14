import { Receipt } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { Link } from "@/i18n/navigation"

import { EmptyState } from "@/components/feedback/empty-state"
import { getFormatters } from "@/i18n/format"
import { PageHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Pagination } from "@/components/ui/pagination"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listConversions } from "@/server/repositories/analytics"
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

const PAGE_SIZE = 50

export default async function ConversionsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/[workspaceSlug]/conversions">) {
  const t = await getTranslations("dashboard.conversions")
  const tc = await getTranslations("common.table")
  const ta = await getTranslations("common.actions")
  const f = await getFormatters()
  const { workspaceSlug } = await params
  const query = await searchParams
  const page = Math.max(1, Math.floor(Number(query.page ?? 1)) || 1)

  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)

  const [result, integrations] = await withUser(user.id, (tx) =>
    Promise.all([
      listConversions(tx, {
        workspaceId: workspace.id,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
      listIntegrations(tx, workspace.id),
    ]),
  )

  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE))
  const billingConnected = integrations.some((integration) => integration.status === "connected")
  const integrationsHref = { pathname: "/[workspaceSlug]/integrations", params: { workspaceSlug } } as const
  const pageHref = (target: number) =>
    ({
      pathname: "/[workspaceSlug]/conversions",
      params: { workspaceSlug },
      query: { page: target },
    }) as const
  const conversions = result.rows

  const pagination =
    pages > 1 || page > pages ? (
      <Pagination
        label={t("pagination")}
        summary={t("pageOf", { page: Math.min(page, pages), pages, total: f.number(result.total) })}
        // Past the last page (a stale link), "previous" leads back to the last real one.
        previous={page > 1 ? <Link href={pageHref(Math.min(page - 1, pages))} /> : null}
        next={page < pages ? <Link href={pageHref(page + 1)} /> : null}
        previousLabel={ta("previous")}
        nextLabel={ta("next")}
      />
    ) : null

  return (
    <>
      <PageHeader
        title={t("title")}
        meta={result.total === 0 ? undefined : f.number(result.total)}
        description={t("description")}
      />

      {result.total === 0 ? (
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
          {/* A stale `?page=` past the end has no rows: pagination alone leads back. */}
          {conversions.length > 0 ? (
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
          ) : null}

          {pagination}
        </>
      )}
    </>
  )
}
