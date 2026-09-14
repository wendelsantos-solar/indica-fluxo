import { Receipt } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { Link } from "@/i18n/navigation"

import { EmptyState } from "@/components/feedback/empty-state"
import { getFormatters } from "@/i18n/format"
import { PageHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { getRecentConversions } from "@/server/repositories/analytics"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/[workspaceSlug]/conversions">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.conversions" })
  return { title: t("title") }
}

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

  const conversions = await withUser(user.id, (tx) =>
    getRecentConversions(tx, workspace.id, 100),
  )

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
      />

      {conversions.length === 0 ? (
        <Card>
          <EmptyState
            icon={Receipt}
            title={t("empty.title")}
            description={t("empty.description")}
            action={
              <Button asChild variant="primary">
                <Link href={{ pathname: "/[workspaceSlug]/integrations", params: { workspaceSlug: workspaceSlug } }}>{ta("connectBilling")}</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <TableContainer scrollable>
          <Table>
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
                <TR key={conversion.id} interactive>
                  <TD className="text-muted-foreground">
                    {f.date(conversion.occurredAt)}
                  </TD>
                  <TD className="text-foreground">{conversion.affiliateName}</TD>
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
      )}
    </>
  )
}
