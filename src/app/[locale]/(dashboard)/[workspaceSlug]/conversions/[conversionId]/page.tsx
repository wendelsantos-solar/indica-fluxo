import {
  Coins,
  CreditCard,
  type LucideIcon,
  MousePointerClick,
  RotateCcw,
  Undo2,
  UserCheck,
} from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import type * as React from "react"

import { Link } from "@/i18n/navigation"

import { InlineAlert } from "@/components/feedback/inline-alert"
import { PageHeader, SectionHeader } from "@/components/layout/page-header"
import { Badge, StatusBadge } from "@/components/ui/badge"
import { Term } from "@/components/ui/term"
import { buildConversionTrail, landingPath, type TrailEvent } from "@/features/conversions/trail"
import { formatBatchLabel } from "@/features/payouts/batch-label"
import { describeRuleApplied } from "@/features/conversions/rule-applied"
import { EnvironmentBadge } from "@/features/programs/environment-badge"
import { getFormatters } from "@/i18n/format"
import { parseUuidParam } from "@/lib/list-params"
import { cn } from "@/lib/utils"
import { requireUser } from "@/server/auth/session"
import { withUser } from "@/server/db"
import {
  getConversionTrail,
  TRAIL_COMMISSION_LIMIT,
  TRAIL_TRANSACTION_LIMIT,
  type TrailClick,
} from "@/server/repositories/conversion-trail"
import { getWorkspaceForUser } from "@/server/services/workspaces"

export const dynamic = "force-dynamic"

// Typed by hand rather than with the generated `PageProps<…>`, so the page does
// not depend on route type generation having run for this new segment.
interface ConversionTrailPageProps {
  params: Promise<{ locale: string; workspaceSlug: string; conversionId: string }>
}

export async function generateMetadata({ params }: ConversionTrailPageProps): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "dashboard.conversion" })
  return { title: t("metaTitle") }
}

const UTM_KEYS = ["source", "medium", "campaign", "content", "term"] as const

/**
 * One conversion's path, click to commission — the promise the landing makes.
 * Everything is read as the member under RLS; the ordering and the first/last
 * click rules live in `features/conversions/trail.ts`.
 */
export default async function ConversionTrailPage({ params }: ConversionTrailPageProps) {
  const { workspaceSlug, conversionId: rawId } = await params
  // Not a uuid is not a conversion; Postgres would reject the cast with a 500.
  const conversionId = parseUuidParam(rawId)
  if (!conversionId) notFound()

  const t = await getTranslations("dashboard.conversion")
  const tconv = await getTranslations("dashboard.conversions")
  const tcomm = await getTranslations("dashboard.commissions")
  const tprog = await getTranslations("dashboard.program")
  const tbatch = await getTranslations("dashboard.payouts.batchStatus")
  const locale = await getLocale()

  const user = await requireUser()
  const workspace = await getWorkspaceForUser(user.id, workspaceSlug)
  const f = await getFormatters(workspace.timezone)
  const trule = await getTranslations("common.rule")

  // RLS hides another workspace's ledger, and the query scopes to this
  // workspace as well, so an unknown and a foreign id both read as not found.
  const data = await withUser(user.id, (tx) => getConversionTrail(tx, workspace.id, conversionId))
  if (!data) notFound()

  const trail = buildConversionTrail(data)
  const opened = data.commissions.find((commission) => commission.id === data.conversionId)

  // Instants on the workspace's wall clock, date and time: a path is read by the minute.
  const dateTime = new Intl.DateTimeFormat(f.locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: f.timeZone,
  })
  const when = (value: Date) => dateTime.format(value)
  const signed = (amountMinor: number, currency: string) =>
    f.money(amountMinor, currency, { signDisplay: amountMinor < 0 ? "always" : "auto" })

  const affiliateHref = {
    pathname: "/[workspaceSlug]/affiliates/[affiliateId]",
    params: { workspaceSlug, affiliateId: data.affiliate.id },
  } as const
  const programHref = {
    pathname: "/[workspaceSlug]/programs/[programSlug]",
    params: { workspaceSlug, programSlug: data.program.slug },
  } as const

  const model = data.attribution?.model ?? data.program.attributionModel
  const truncated =
    data.transactions.length >= TRAIL_TRANSACTION_LIMIT || data.commissions.length >= TRAIL_COMMISSION_LIMIT

  const clickDetails = (click: TrailClick): Detail[] => {
    const utm = UTM_KEYS.flatMap((key) => {
      const value = click.utm[key]
      return value ? [`utm_${key}=${value}`] : []
    })
    return [
      {
        term: t("fields.link"),
        value: (
          <>
            {click.linkName ? <span className="mr-2 text-foreground-secondary">{click.linkName}</span> : null}
            <span className="font-mono">{click.linkCode ?? click.code}</span>
          </>
        ),
      },
      {
        term: t("fields.landing"),
        value: (
          <span className="block truncate font-mono" title={click.landingUrl}>
            {landingPath(click.landingUrl)}
          </span>
        ),
      },
      {
        term: t("fields.referrer"),
        value: click.referrerUrl ? (
          <span className="block truncate font-mono" title={click.referrerUrl}>
            {click.referrerUrl}
          </span>
        ) : (
          t("fields.direct")
        ),
      },
      ...(utm.length > 0
        ? [{ term: t("fields.utm"), value: <span className="break-all font-mono">{utm.join(" · ")}</span> }]
        : []),
    ]
  }

  const renderEvent = (event: TrailEvent, index: number) => {
    const key = `${event.kind}-${index}`
    switch (event.kind) {
      case "click":
        return (
          <TrailItem
            key={key}
            icon={MousePointerClick}
            title={event.role === "first" ? t("events.firstClick") : t("events.lastClick")}
            time={when(event.at)}
            note={event.otherAffiliate ? t("events.otherAffiliate", { name: event.click.affiliateName }) : undefined}
            details={clickDetails(event.click)}
          />
        )
      case "identified":
        return (
          <TrailItem
            key={key}
            icon={UserCheck}
            title={t("events.identified")}
            time={t("events.identifiedUndated")}
            details={[
              ...(event.externalId
                ? [{ term: t("fields.externalId"), value: <span className="font-mono">{event.externalId}</span> }]
                : []),
              ...(event.providerCustomerId
                ? [
                    {
                      term: t("fields.providerCustomerId"),
                      value: <span className="font-mono">{event.providerCustomerId}</span>,
                    },
                  ]
                : []),
            ]}
          />
        )
      case "transaction": {
        const { transaction } = event
        const refund = transaction.type === "refund" || transaction.type === "chargeback"
        return (
          <TrailItem
            key={key}
            icon={refund ? Undo2 : CreditCard}
            title={t(`transactionType.${transaction.type}`)}
            time={when(event.at)}
            amount={signed(transaction.grossAmountMinor, transaction.currency)}
            negative={transaction.grossAmountMinor < 0}
            highlighted={event.highlighted}
            highlightLabel={t("thisConversion")}
            badge={
              transaction.status === "succeeded" ? undefined : (
                <StatusBadge status={transaction.status} label={t(`transactionStatus.${transaction.status}`)} />
              )
            }
            details={[
              {
                term: t("fields.transaction"),
                value: <span className="block truncate font-mono">{transaction.providerTransactionId}</span>,
              },
            ]}
          />
        )
      }
      case "commission":
      case "reversal": {
        const { commission } = event
        const isReversal = event.kind === "reversal"
        const details: Detail[] = [
          {
            term: t("fields.base"),
            value: (
              <span className="tabular-nums">
                {signed(commission.baseAmountMinor, commission.currency)}
                {" · "}
                {commission.commissionRate !== null ? f.basisPoints(commission.commissionRate) : tcomm("fixed")}
              </span>
            ),
          },
          ...(describeRuleApplied(commission.ruleApplied, commission.currency, f, trule)
            ? [
                {
                  term: t("fields.rule"),
                  value: (
                    <span className="break-words">
                      {describeRuleApplied(commission.ruleApplied, commission.currency, f, trule)}
                    </span>
                  ),
                },
              ]
            : []),
          // A reversal is final at once; only a commission waits for its hold to end.
          ...(isReversal ? [] : [{ term: t("fields.releasedOn"), value: f.date(commission.eligibleAt) }]),
          ...(commission.paidAt ? [{ term: t("fields.paidOn"), value: f.date(commission.paidAt) }] : []),
          ...(commission.batch
            ? [
                {
                  term: t("fields.batch"),
                  value: (
                    <Link
                      href={{
                        pathname: "/[workspaceSlug]/payouts/[batchId]",
                        params: { workspaceSlug, batchId: commission.batch.id },
                      }}
                      className="rounded-badge text-foreground hover:underline"
                    >
                      {formatBatchLabel(locale, commission.batch.periodEnd, commission.batch.reference)}
                      <span className="text-muted-foreground"> · {tbatch(commission.batch.status)}</span>
                    </Link>
                  ),
                },
              ]
            : []),
        ]
        return (
          <TrailItem
            key={key}
            icon={isReversal ? RotateCcw : Coins}
            title={isReversal ? t("events.reversal") : t("events.commission")}
            time={when(event.at)}
            amount={signed(commission.commissionAmountMinor, commission.currency)}
            negative={commission.commissionAmountMinor < 0}
            highlighted={event.highlighted}
            highlightLabel={t("thisConversion")}
            badge={<StatusBadge status={commission.status} label={tcomm(`statusLabel.${commission.status}`)} />}
            details={details}
          />
        )
      }
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb={[
          <Link key="conversions" href={{ pathname: "/[workspaceSlug]/conversions", params: { workspaceSlug } }}>
            {tconv("title")}
          </Link>,
        ]}
        title={t("title", { customer: data.customer.ref })}
        meta={
          opened || data.program.environment === "test" ? (
            // The trail opens whichever environment the dashboard shows; a test one says so.
            <span className="flex items-center gap-1.5">
              {data.program.environment === "test" ? <EnvironmentBadge environment="test" /> : null}
              {opened ? <StatusBadge status={opened.status} label={tcomm(`statusLabel.${opened.status}`)} /> : null}
            </span>
          ) : undefined
        }
        description={t("description")}
      />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-12">
        <section aria-labelledby="trail-heading" className="min-w-0 max-w-detail">
          <h2 id="trail-heading" className="sr-only">
            {t("timeline")}
          </h2>

          {trail.attributionState === "missing" ? (
            <InlineAlert title={t("missing.title")} className="mb-6">
              {t("missing.description")}
            </InlineAlert>
          ) : trail.attributionState === "moved" ? (
            <InlineAlert title={t("moved.title")} className="mb-6">
              {t("moved.description", { name: data.affiliate.name })}
            </InlineAlert>
          ) : data.clicks.length === 0 ? (
            <InlineAlert className="mb-6">{t("clicksUnavailable")}</InlineAlert>
          ) : null}

          <ol>{trail.events.map(renderEvent)}</ol>

          {truncated ? (
            <p className="mt-6 border-t border-border-faint pt-3 text-meta text-muted-foreground">
              {t("truncated", { count: TRAIL_TRANSACTION_LIMIT })}
            </p>
          ) : null}
        </section>

        {/* Who got the credit, and under which rule. */}
        <aside className="min-w-0 lg:border-l lg:border-border lg:pl-6">
          <SectionHeader title={t("side.title")} />
          <dl className="text-caption">
            <SideRow term={t("side.affiliate")}>
              <Link href={affiliateHref} className="rounded-badge text-foreground hover:underline">
                {data.affiliate.name}
              </Link>
              <span className="block font-mono text-meta text-muted-foreground">{data.affiliate.code}</span>
            </SideRow>
            <SideRow term={t("side.program")}>
              <Link href={programHref} className="rounded-badge text-foreground hover:underline">
                {data.program.name}
              </Link>
            </SideRow>
            <SideRow term={<Term definition={tprog("terms.model")}>{t("side.model")}</Term>}>
              {model === "first_click" ? tprog("firstClick") : tprog("lastClick")}
            </SideRow>
            <SideRow term={<Term definition={tprog("terms.window")}>{t("side.window")}</Term>}>
              {tprog("nDays", { count: data.program.attributionWindowDays })}
            </SideRow>
            <SideRow term={t("side.attributedAt")}>
              {data.attribution ? when(data.attribution.attributedAt) : t("side.none")}
            </SideRow>
            <SideRow term={t("side.expiresAt")}>
              {data.attribution ? when(data.attribution.expiresAt) : t("side.none")}
            </SideRow>
            <SideRow term={t("side.customer")}>
              <span className="break-all font-mono text-meta">{data.customer.ref}</span>
            </SideRow>
          </dl>
          <p className="mt-3 text-meta text-faint-foreground">{t("side.timesIn", { zone: f.timeZone })}</p>
        </aside>
      </div>
    </>
  )
}

interface Detail {
  term: string
  value: React.ReactNode
}

/** One step of the path, drawn like the landing's timeline: a ringed icon on a hairline. */
function TrailItem({
  icon: Icon,
  title,
  time,
  amount,
  negative = false,
  badge,
  note,
  highlighted = false,
  highlightLabel,
  details = [],
}: {
  icon: LucideIcon
  title: string
  time: string
  amount?: string
  negative?: boolean
  badge?: React.ReactNode
  note?: string
  highlighted?: boolean
  highlightLabel?: string
  details?: Detail[]
}) {
  return (
    <li
      aria-current={highlighted ? "true" : undefined}
      className={cn(
        "relative flex gap-3 pb-6 last:pb-0",
        // The hairline runs from under this icon to the next one.
        "before:absolute before:bottom-0 before:left-3.5 before:top-8 before:w-px before:bg-border last:before:hidden",
      )}
    >
      <span
        className={cn(
          "relative z-raised flex size-7 shrink-0 items-center justify-center rounded-full border bg-surface-1",
          highlighted ? "border-border-strong text-foreground" : "border-border text-muted-foreground",
        )}
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="text-caption font-medium text-foreground">{title}</p>
            {badge}
            {highlighted && highlightLabel ? <Badge dot={false}>{highlightLabel}</Badge> : null}
          </div>
          {amount ? (
            <p
              className={cn(
                "whitespace-nowrap text-caption font-medium tabular-nums",
                negative ? "text-danger-foreground" : "text-foreground",
              )}
            >
              {amount}
            </p>
          ) : null}
        </div>
        <p className="text-meta tabular-nums text-faint-foreground">{time}</p>
        {note ? <p className="mt-1 text-meta text-muted-foreground">{note}</p> : null}
        {details.length > 0 ? (
          <dl className="mt-2 grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-4 gap-y-1 text-meta">
            {details.map((detail) => (
              <div key={detail.term} className="contents">
                <dt className="text-muted-foreground">{detail.term}</dt>
                <dd className="min-w-0 text-foreground-secondary">{detail.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </li>
  )
}

function SideRow({ term, children }: { term: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-10 items-start justify-between gap-4 border-b border-border-faint py-2.5">
      <dt className="shrink-0 text-muted-foreground">{term}</dt>
      <dd className="min-w-0 text-right text-foreground-secondary">{children}</dd>
    </div>
  )
}
