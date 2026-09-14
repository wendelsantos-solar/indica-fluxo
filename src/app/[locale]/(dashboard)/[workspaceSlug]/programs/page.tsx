import { Layers, Plus } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { Link } from "@/i18n/navigation"

import { EmptyState } from "@/components/feedback/empty-state"
import { getFormatters } from "@/i18n/format"
import { PageHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { Term } from "@/components/ui/term"
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

  const newProgramHref = {
    pathname: "/[workspaceSlug]/programs/new",
    params: { workspaceSlug },
  } as const

  return (
    <>
      <PageHeader
        title={t("title")}
        meta={programs.length > 0 ? f.number(programs.length) : undefined}
        description={t("description")}
        actions={
          // On a first run the empty state carries the one primary action.
          programs.length > 0 ? (
            <Button asChild variant="primary" size="sm">
              <Link href={newProgramHref}>
                <Plus aria-hidden="true" />
                {t("create")}
              </Link>
            </Button>
          ) : null
        }
      />

      {programs.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={t("empty.title")}
          description={t("empty.description")}
          action={
            <Button asChild variant="primary">
              <Link href={newProgramHref}>{t("empty.action")}</Link>
            </Button>
          }
        />
      ) : (
        <TableContainer>
          <Table>
            <THead className="max-md:hidden">
              <tr>
                <TH>{tc("program")}</TH>
                <TH>{tc("status")}</TH>
                <TH>{tc("commission")}</TH>
                <TH className="max-lg:hidden">
                  <Term definition={t("attributionDefinition")}>{t("attribution")}</Term>
                </TH>
                <TH numeric>{t("affiliates")}</TH>
                <TH numeric className="max-lg:hidden">{tc("clicks")}</TH>
                <TH numeric>{t("commissionEarned")}</TH>
              </tr>
            </THead>
            <TBody>
              {programs.map((program) => {
                const rule =
                  program.commissionType === "percentage"
                    ? f.basisPoints(program.commissionValue)
                    : f.money(program.commissionValue, program.currency)
                const duration =
                  program.commissionDurationMonths === null
                    ? t("lifetime")
                    : program.commissionDurationMonths === 1
                      ? t("firstPayment")
                      : t("nMonths", { count: program.commissionDurationMonths })
                const earned = f.money(program.commissionTotalMinor, program.currency)

                return (
                  <TR key={program.id} interactive className="relative">
                    <TD className="max-md:py-2.5">
                      <div className="flex items-center justify-between gap-3">
                        {/* The link stretches over the whole row. */}
                        <Link
                          href={{
                            pathname: "/[workspaceSlug]/programs/[programSlug]",
                            params: { workspaceSlug, programSlug: program.slug },
                          }}
                          className={
                            "truncate font-medium text-foreground outline-none after:absolute after:inset-0 after:rounded-control " +
                            // The focus ring moves to the stretched overlay, so the whole row is outlined.
                            "focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring"
                          }
                        >
                          {program.name}
                        </Link>
                        <StatusBadge status={program.status} className="md:hidden" />
                      </div>
                      <span className="block font-mono text-meta text-muted-foreground max-md:hidden">
                        {program.slug}
                      </span>
                      <span className="mt-0.5 flex gap-3 text-meta text-muted-foreground md:hidden">
                        <span>
                          {rule} · {duration}
                        </span>
                        <span className="ml-auto tabular-nums text-foreground-secondary">{earned}</span>
                      </span>
                    </TD>
                    <TD className="max-md:hidden">
                      <StatusBadge status={program.status} />
                    </TD>
                    <TD className="whitespace-nowrap max-md:hidden">
                      {rule}
                      <span className="text-muted-foreground">{` · ${duration}`}</span>
                    </TD>
                    <TD className="whitespace-nowrap max-lg:hidden">
                      {program.attributionModel === "last_click" ? t("lastClick") : t("firstClick")}
                      <span className="text-muted-foreground">
                        {` · ${t("nDays", { count: program.attributionWindowDays })}`}
                      </span>
                    </TD>
                    <TD numeric className="max-md:hidden">
                      {f.number(program.affiliateCount)}
                    </TD>
                    <TD numeric className="max-lg:hidden">
                      {f.number(program.clickCount)}
                    </TD>
                    <TD numeric className="text-foreground max-md:hidden">
                      {earned}
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        </TableContainer>
      )}
    </>
  )
}
