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
import { EnvironmentBadge } from "@/features/programs/environment-badge"
import { programAvailability } from "@/features/programs/plan-availability"
import { ProgramPlanNotice } from "@/features/programs/program-plan-notice"
import { formatMoneyTotals } from "@/lib/money-totals"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listPrograms } from "@/server/repositories/programs"
import { getPlanOverview } from "@/server/services/plans"
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
  const tm = await getTranslations("common.money")
  const { workspaceSlug } = await params
  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)
  const f = await getFormatters(workspace.timezone)
  const [programs, plan] = await Promise.all([
    withUser(user.id, (tx) => listPrograms(tx, workspace.id)),
    getPlanOverview(user.id, workspace.id),
  ])

  // `createProgram` refuses a program past the plan's limits (per environment);
  // say so here, before the founder fills in a form that cannot be saved.
  const availability = programAvailability(plan.entitlements, plan.usage)
  const canCreate = availability.test || availability.live
  const limitNoticeId = "program-plan-limit"
  const { limits, features } = plan.entitlements.capabilities
  const usageLine = [
    features.liveMode
      ? limits.livePrograms === null
        ? t("usage.liveUnlimited", { used: plan.usage.livePrograms })
        : t("usage.live", { used: plan.usage.livePrograms, limit: limits.livePrograms })
      : t("usage.liveUnavailable"),
    limits.testPrograms === null
      ? t("usage.testUnlimited", { used: plan.usage.testPrograms })
      : t("usage.test", { used: plan.usage.testPrograms, limit: limits.testPrograms }),
  ].join(" · ")

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
          programs.length === 0 ? null : !canCreate ? (
            // Disabled, and described by the notice below that explains why.
            <Button variant="secondary" size="sm" disabled aria-describedby={limitNoticeId}>
              <Plus aria-hidden="true" />
              {t("create")}
            </Button>
          ) : (
            <Button asChild variant="primary" size="sm">
              <Link href={newProgramHref}>
                <Plus aria-hidden="true" />
                {t("create")}
              </Link>
            </Button>
          )
        }
      />

      <ProgramPlanNotice
        workspaceSlug={workspaceSlug}
        availability={availability}
        id={limitNoticeId}
        className="mb-6"
      />

      {programs.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={t("empty.title")}
          description={t("empty.description")}
          action={
            canCreate ? (
              <Button asChild variant="primary">
                <Link href={newProgramHref}>{t("empty.action")}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className="mb-3 text-meta tabular-nums text-muted-foreground">{usageLine}</p>
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
                  // The program's currency leads; anything earned under an earlier
                  // currency setting is listed beside it, never added in.
                  const earned = formatMoneyTotals(f.money, program.commissionTotals, program.currency)
                  const earnedOthers = earned.others
                    ? tm("otherCurrencies", { amounts: earned.others })
                    : null

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
                          <span className="flex shrink-0 items-center gap-1.5 md:hidden">
                            <EnvironmentBadge environment={program.environment} />
                            <StatusBadge status={program.status} />
                          </span>
                        </div>
                        <span className="flex items-center gap-2 max-md:hidden">
                          <span className="truncate font-mono text-meta text-muted-foreground">{program.slug}</span>
                          <EnvironmentBadge environment={program.environment} />
                        </span>
                        <span className="mt-0.5 flex gap-3 text-meta text-muted-foreground md:hidden">
                          <span>
                            {rule} · {duration}
                          </span>
                          <span className="ml-auto text-right tabular-nums text-foreground-secondary">
                            {earned.primary}
                            {earnedOthers ? (
                              <span className="block text-muted-foreground">{earnedOthers}</span>
                            ) : null}
                          </span>
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
                        {earned.primary}
                        {earnedOthers ? (
                          <span className="block text-meta text-muted-foreground">{earnedOthers}</span>
                        ) : null}
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </TableContainer>
        </>
      )}
    </>
  )
}
