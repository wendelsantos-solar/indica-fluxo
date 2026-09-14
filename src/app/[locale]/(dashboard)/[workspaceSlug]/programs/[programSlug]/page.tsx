import { Users } from "lucide-react"
import type { Metadata } from "next"
import { getLocale } from "next-intl/server"
import { notFound } from "next/navigation"

import { getPathname, Link } from "@/i18n/navigation"

import { Metric, MetricCell, MetricGrid } from "@/components/data-display/metric"
import { getFormatters } from "@/i18n/format"
import { EmptyState } from "@/components/feedback/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { StatusBadge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { TabLink } from "@/components/ui/tabs"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { InviteAffiliateDialog } from "@/features/affiliates/invite-affiliate-dialog"
import { ProgramForm } from "@/features/programs/program-form"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import { listAffiliates } from "@/server/repositories/affiliates"
import { listCommissions } from "@/server/repositories/commissions"
import { findProgramBySlug } from "@/server/repositories/programs"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const metadata: Metadata = { title: "Program" }
export const dynamic = "force-dynamic"

const TABS = ["overview", "affiliates", "commissions", "settings"] as const
type Tab = (typeof TABS)[number]

export default async function ProgramDetailPage({
  params,
  searchParams,
}: PageProps<"/[locale]/[workspaceSlug]/programs/[programSlug]">) {
  const f = await getFormatters()
  const { workspaceSlug, programSlug } = await params
  const query = await searchParams
  const tab: Tab = TABS.includes(query.tab as Tab) ? (query.tab as Tab) : "overview"

  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)

  const program = await withUser(user.id, (tx) =>
    findProgramBySlug(tx, workspace.id, programSlug),
  )
  if (!program) notFound()

  const [affiliates, commissions] = await withUser(user.id, (tx) =>
    Promise.all([
      listAffiliates(tx, { workspaceId: workspace.id, programId: program.id, limit: 50 }),
      listCommissions(tx, { workspaceId: workspace.id, programId: program.id, limit: 50 }),
    ]),
  )

  const totals = affiliates.rows.reduce(
    (acc, row) => ({
      clicks: acc.clicks + row.clicks,
      customers: acc.customers + row.customers,
      revenue: acc.revenue + row.revenueMinor,
      commission: acc.commission + row.commissionMinor,
    }),
    { clicks: 0, customers: 0, revenue: 0, commission: 0 },
  )

  // TabLink renders a plain anchor, so the href has to be a real URL rather
  // than a canonical pathname — `getPathname` resolves the locale prefix and
  // the translated segments that `Link` would otherwise apply for us.
  const base = getPathname({
    href: {
      pathname: "/[workspaceSlug]/programs/[programSlug]",
      params: { workspaceSlug, programSlug },
    },
    locale: await getLocale(),
  })

  return (
    <>
      <PageHeader
        title={program.name}
        description={program.description ?? undefined}
        meta={<StatusBadge status={program.status} />}
        actions={
          <InviteAffiliateDialog
            workspaceSlug={workspaceSlug}
            programs={[{ id: program.id, name: program.name }]}
            defaultProgramId={program.id}
          />
        }
      />

      <dl className="mb-6 flex flex-wrap gap-x-8 gap-y-3 rounded-panel border border-border bg-surface-1 px-5 py-4">
        <SummaryItem
          label="Commission"
          value={
            program.commissionType === "percentage"
              ? f.basisPoints(program.commissionValue)
              : f.money(program.commissionValue, program.currency)
          }
        />
        <SummaryItem
          label="Duration"
          value={
            program.commissionDurationMonths === null
              ? "Lifetime"
              : program.commissionDurationMonths === 1
                ? "First payment"
                : `${program.commissionDurationMonths} months`
          }
        />
        <SummaryItem label="Attribution" value={`${program.attributionWindowDays}-day window`} />
        <SummaryItem
          label="Model"
          value={program.attributionModel === "last_click" ? "Last click" : "First click"}
        />
        <SummaryItem label="Hold" value={`${program.commissionHoldDays} days`} />
      </dl>

      <nav className="mb-5 flex items-center gap-1 border-b border-border" aria-label="Program sections">
        <TabLink href={`${base}?tab=overview`} active={tab === "overview"}>
          Overview
        </TabLink>
        <TabLink href={`${base}?tab=affiliates`} active={tab === "affiliates"}>
          Affiliates
        </TabLink>
        <TabLink href={`${base}?tab=commissions`} active={tab === "commissions"}>
          Commissions
        </TabLink>
        <TabLink href={`${base}?tab=settings`} active={tab === "settings"}>
          Settings
        </TabLink>
      </nav>

      {tab === "overview" ? (
        <MetricGrid className="lg:grid-cols-4">
          <MetricCell>
            <Metric label="Clicks" value={f.number(totals.clicks)} />
          </MetricCell>
          <MetricCell>
            <Metric
              label="Customers"
              value={f.number(totals.customers)}
              comparison={f.rate(totals.customers, totals.clicks)}
            />
          </MetricCell>
          <MetricCell>
            <Metric label="Revenue" value={f.money(totals.revenue, program.currency)} />
          </MetricCell>
          <MetricCell>
            <Metric label="Commission" value={f.money(totals.commission, program.currency)} />
          </MetricCell>
        </MetricGrid>
      ) : null}

      {tab === "affiliates" ? (
        affiliates.rows.length === 0 ? (
          <Card>
            <EmptyState
              icon={Users}
              title="No affiliates in this program"
              description="Invite someone and they will receive a referral code immediately."
              action={
                <InviteAffiliateDialog
                  workspaceSlug={workspaceSlug}
                  programs={[{ id: program.id, name: program.name }]}
                  defaultProgramId={program.id}
                  triggerLabel="Invite the first affiliate"
                />
              }
            />
          </Card>
        ) : (
          <TableContainer scrollable>
            <Table>
              <THead>
                <tr>
                  <TH>Affiliate</TH>
                  <TH>Code</TH>
                  <TH>Status</TH>
                  <TH numeric>Clicks</TH>
                  <TH numeric>Customers</TH>
                  <TH numeric>Commission</TH>
                </tr>
              </THead>
              <TBody>
                {affiliates.rows.map((row) => (
                  <TR key={row.participationId ?? row.affiliateId}>
                    <TD className="text-foreground">{row.name}</TD>
                    <TD mono>{row.code}</TD>
                    <TD>
                      <StatusBadge status={row.participationStatus ?? row.status} />
                    </TD>
                    <TD numeric>{f.number(row.clicks)}</TD>
                    <TD numeric>{f.number(row.customers)}</TD>
                    <TD numeric className="text-foreground">
                      {f.money(row.commissionMinor, program.currency)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        )
      ) : null}

      {tab === "commissions" ? (
        commissions.rows.length === 0 ? (
          <Card>
            <EmptyState
              icon={Users}
              title="No commissions in this program yet"
              description="They appear as soon as a tracked customer pays."
              action={
                <Link
                  href={{ pathname: "/[workspaceSlug]/integrations", params: { workspaceSlug: workspaceSlug } }}
                  className="text-caption text-foreground underline-offset-4 hover:underline"
                >
                  Check your billing connection
                </Link>
              }
            />
          </Card>
        ) : (
          <TableContainer scrollable>
            <Table>
              <THead>
                <tr>
                  <TH>Affiliate</TH>
                  <TH>Customer</TH>
                  <TH numeric>Base</TH>
                  <TH numeric>Commission</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <TBody>
                {commissions.rows.map((row) => (
                  <TR key={row.id}>
                    <TD className="text-foreground">{row.affiliateName}</TD>
                    <TD mono>{row.customerRef}</TD>
                    <TD numeric>{f.money(row.baseAmountMinor, row.currency)}</TD>
                    <TD numeric className="text-foreground">
                      {f.money(row.commissionAmountMinor, row.currency)}
                    </TD>
                    <TD>
                      <StatusBadge status={row.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        )
      ) : null}

      {tab === "settings" ? (
        <div className="max-w-3xl">
          <ProgramForm
            mode="edit"
            workspaceSlug={workspaceSlug}
            defaultValues={{
              id: program.id,
              name: program.name,
              description: program.description ?? "",
              status: program.status,
              commissionType: program.commissionType,
              commissionAmount: String(program.commissionValue / 100),
              recurrence:
                program.commissionDurationMonths === null
                  ? "lifetime"
                  : program.commissionDurationMonths === 1
                    ? "first_only"
                    : "months",
              durationMonths: String(program.commissionDurationMonths ?? 12),
              attributionModel: program.attributionModel,
              attributionWindowDays: String(program.attributionWindowDays),
              commissionHoldDays: String(program.commissionHoldDays),
              currency: program.currency,
            }}
          />
        </div>
      ) : null}
    </>
  )
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-label uppercase tracking-[0.02em] text-muted-foreground">{label}</dt>
      <dd className="text-caption font-medium text-foreground">{value}</dd>
    </div>
  )
}
