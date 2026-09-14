import { Layers, Plus } from "lucide-react"
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
import { listPrograms } from "@/server/repositories/programs"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/[workspaceSlug]/programs">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.programs" })
  return { title: t("title") }
}

export default async function ProgramsPage({ params }: PageProps<"/[locale]/[workspaceSlug]/programs">) {
  const t = await getTranslations("dashboard.programs")
  const tc = await getTranslations("common.table")
  const f = await getFormatters()
  const { workspaceSlug } = await params
  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)
  const programs = await withUser(user.id, (tx) => listPrograms(tx, workspace.id))

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button asChild variant="primary">
            <Link href={{ pathname: "/[workspaceSlug]/programs/new", params: { workspaceSlug: workspaceSlug } }}>
              <Plus aria-hidden="true" />
              {t("create")}
            </Link>
          </Button>
        }
      />

      {programs.length === 0 ? (
        <Card>
          <EmptyState
            icon={Layers}
            title={t("empty.title")}
            description={t("empty.description")}
            action={
              <Button asChild variant="primary">
                <Link href={{ pathname: "/[workspaceSlug]/programs/new", params: { workspaceSlug: workspaceSlug } }}>{t("empty.action")}</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <TableContainer scrollable>
          <Table>
            <THead>
              <tr>
                <TH>{tc("program")}</TH>
                <TH>{tc("status")}</TH>
                <TH>{tc("commission")}</TH>
                <TH>{t("attribution")}</TH>
                <TH numeric>{t("affiliates")}</TH>
                <TH numeric>{tc("clicks")}</TH>
                <TH numeric>{t("commissionEarned")}</TH>
              </tr>
            </THead>
            <TBody>
              {programs.map((program) => (
                <TR key={program.id} interactive>
                  <TD>
                    <Link
                      href={{ pathname: "/[workspaceSlug]/programs/[programSlug]", params: { workspaceSlug, programSlug: program.slug } }}
                      className="font-medium text-foreground hover:underline"
                    >
                      {program.name}
                    </Link>
                    <span className="block font-mono text-label text-muted-foreground">
                      {program.slug}
                    </span>
                  </TD>
                  <TD>
                    <StatusBadge status={program.status} />
                  </TD>
                  <TD>
                    {program.commissionType === "percentage"
                      ? f.basisPoints(program.commissionValue)
                      : f.money(program.commissionValue, program.currency)}
                    <span className="text-muted-foreground">
                      {" · "}
                      {program.commissionDurationMonths === null
                        ? t("lifetime")
                        : program.commissionDurationMonths === 1
                          ? t("firstPayment")
                          : t("nMonths", { count: program.commissionDurationMonths })}
                    </span>
                  </TD>
                  <TD>
                    {program.attributionModel === "last_click" ? t("lastClick") : t("firstClick")}
                    <span className="text-muted-foreground">
                      {` · ${t("nDays", { count: program.attributionWindowDays })}`}
                    </span>
                  </TD>
                  <TD numeric>{f.number(program.affiliateCount)}</TD>
                  <TD numeric>{f.number(program.clickCount)}</TD>
                  <TD numeric className="text-foreground">
                    {f.money(program.commissionTotalMinor, program.currency)}
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
