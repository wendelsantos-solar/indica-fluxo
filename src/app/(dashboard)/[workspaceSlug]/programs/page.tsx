import { Layers, Plus } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

import { EmptyState } from "@/components/feedback/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { formatBasisPoints, formatMoney, formatNumber } from "@/lib/money"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listPrograms } from "@/server/repositories/programs"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const metadata: Metadata = { title: "Programs" }
export const dynamic = "force-dynamic"

export default async function ProgramsPage({ params }: PageProps<"/[workspaceSlug]/programs">) {
  const { workspaceSlug } = await params
  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)
  const programs = await withUser(user.id, (tx) => listPrograms(tx, workspace.id))

  return (
    <>
      <PageHeader
        title="Programs"
        description="Each program carries its own commission rule, attribution model and hold period."
        actions={
          <Button asChild variant="primary">
            <Link href={`/${workspaceSlug}/programs/new`}>
              <Plus aria-hidden="true" />
              New program
            </Link>
          </Button>
        }
      />

      {programs.length === 0 ? (
        <Card>
          <EmptyState
            icon={Layers}
            title="No programs yet"
            description="A program defines what affiliates earn and how conversions are attributed. Most SaaS companies start with a single one."
            action={
              <Button asChild variant="primary">
                <Link href={`/${workspaceSlug}/programs/new`}>Create your first program</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <TableContainer scrollable>
          <Table>
            <THead>
              <tr>
                <TH>Program</TH>
                <TH>Status</TH>
                <TH>Commission</TH>
                <TH>Attribution</TH>
                <TH numeric>Affiliates</TH>
                <TH numeric>Clicks</TH>
                <TH numeric>Commission earned</TH>
              </tr>
            </THead>
            <TBody>
              {programs.map((program) => (
                <TR key={program.id} interactive>
                  <TD>
                    <Link
                      href={`/${workspaceSlug}/programs/${program.slug}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {program.name}
                    </Link>
                    <span className="block font-mono text-[11px] text-muted-foreground">
                      {program.slug}
                    </span>
                  </TD>
                  <TD>
                    <StatusBadge status={program.status} />
                  </TD>
                  <TD>
                    {program.commissionType === "percentage"
                      ? formatBasisPoints(program.commissionValue)
                      : formatMoney(program.commissionValue, program.currency)}
                    <span className="text-muted-foreground">
                      {" · "}
                      {program.commissionDurationMonths === null
                        ? "lifetime"
                        : program.commissionDurationMonths === 1
                          ? "first payment"
                          : `${program.commissionDurationMonths} months`}
                    </span>
                  </TD>
                  <TD>
                    {program.attributionModel === "last_click" ? "Last click" : "First click"}
                    <span className="text-muted-foreground">
                      {` · ${program.attributionWindowDays}d`}
                    </span>
                  </TD>
                  <TD numeric>{formatNumber(program.affiliateCount)}</TD>
                  <TD numeric>{formatNumber(program.clickCount)}</TD>
                  <TD numeric className="text-foreground">
                    {formatMoney(program.commissionTotalMinor, program.currency)}
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
