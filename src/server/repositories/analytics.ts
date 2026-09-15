import "server-only"

import { sql } from "drizzle-orm"

import {
  orderMoneyTotals,
  pickPrimaryCurrency,
  subtractMoneyTotals,
  toMoneyTotals,
  type MoneyTotal,
} from "@/lib/money-totals"
import { localDayRange, resolveTimeZone, type LocalDayRange } from "@/lib/time-zone"
import { type DbClient } from "@/server/db"
import { effectiveCommissionStatusSql, type CommissionStatus } from "@/server/repositories/commissions"

/**
 * Read models. These never hydrate entities: every figure is aggregated in
 * Postgres and only the columns a view renders come back. See ARCHITECTURE.md §6.
 */

/**
 * "The last `days` days" of a workspace, on its own wall clock: the window
 * starts at local midnight and day buckets are local dates, so a 22:00 São
 * Paulo payment lands on its own day, not UTC's next one.
 */
export interface AnalyticsWindow {
  days: number
  /** The workspace's IANA zone. Validated here before it reaches SQL. */
  timeZone: string
  /** Defaults to the current instant; pass one `now` to every query of a page. */
  now?: Date
}

interface ResolvedWindow extends LocalDayRange {
  /** A supported zone, bound as a query parameter — never spliced into SQL. */
  timeZone: string
}

function resolveWindow(window: AnalyticsWindow): ResolvedWindow {
  const timeZone = resolveTimeZone(window.timeZone)
  return { timeZone, ...localDayRange(window.now ?? new Date(), timeZone, window.days) }
}

/** A JS instant as a `timestamptz` parameter. */
function instant(value: Date) {
  return sql`${value.toISOString()}::timestamptz`
}

export interface DashboardOverview {
  /**
   * The currency the overview leads with: the workspace default when it has
   * any activity, otherwise the busiest one (`pickPrimaryCurrency`). Every
   * money list below is ordered with it first.
   */
  currency: string
  /** Every money figure is per currency. Summing across them is a defect (D1). */
  revenue: MoneyTotal[]
  revenuePrevious: MoneyTotal[]
  commission: MoneyTotal[]
  netRevenue: MoneyTotal[]
  /**
   * Approved participations with a click or a commission inside the period —
   * the same window as every other figure on the overview.
   */
  activeAffiliates: number
  /** Approved participations, all time. */
  approvedAffiliates: number
  /** Any non-rejected commission, ever — the workspace has produced money. */
  hasCommission: boolean
  customersAcquired: number
  clicks: number
  conversionRate: number
  pendingCommission: MoneyTotal[]
  availableCommission: MoneyTotal[]
}

export async function getDashboardOverview(
  tx: DbClient,
  workspaceId: string,
  period: AnalyticsWindow,
): Promise<DashboardOverview> {
  const window = resolveWindow(period)

  const [counts] = await tx.execute<{
    default_currency: string | null
    active_affiliates: number
    approved_affiliates: number
    has_commission: boolean
    customers_acquired: number
    clicks: number
  }>(sql`
    with bounds as (select ${instant(window.start)} as current_start)
    select
      (select default_currency from workspaces where id = ${workspaceId}) as default_currency,
      (select count(distinct pa.id)
         from program_affiliates pa
         join programs p on p.id = pa.program_id
        where p.workspace_id = ${workspaceId} and pa.status = 'approved')::int as approved_affiliates,
      (select count(distinct pa.id)
         from program_affiliates pa
         join programs p on p.id = pa.program_id
        where p.workspace_id = ${workspaceId}
          and pa.status = 'approved'
          and (
            exists (select 1 from referral_clicks rc
                     where rc.program_affiliate_id = pa.id
                       and rc.occurred_at >= (select current_start from bounds))
            or exists (select 1 from commissions c
                        where c.program_affiliate_id = pa.id
                          and c.status <> 'rejected'
                          and c.created_at >= (select current_start from bounds))
          ))::int as active_affiliates,
      exists (select 1 from commissions c
               where c.workspace_id = ${workspaceId} and c.status <> 'rejected') as has_commission,
      (select count(distinct t.customer_id)
         from transactions t
         join commissions c on c.transaction_id = t.id
        where t.workspace_id = ${workspaceId}
          and t.type = 'payment'
          and t.occurred_at >= (select current_start from bounds))::int as customers_acquired,
      (select count(*)
         from referral_clicks rc
         join programs p on p.id = rc.program_id
        where p.workspace_id = ${workspaceId}
          and rc.occurred_at >= (select current_start from bounds))::int as clicks
  `)

  // One row per currency. Sums are `bigint` (int4 overflows at 21 474 836,47)
  // and come back from the driver as strings, hence the `Number` below.
  const money = await tx.execute<{
    currency: string
    revenue_minor: string
    revenue_previous_minor: string
    commission_minor: string
    pending_minor: string
    available_minor: string
  }>(sql`
    with bounds as (
      select
        ${instant(window.start)} as current_start,
        ${instant(window.previousStart)} as previous_start
    ),
    revenue as (
      select
        t.currency,
        coalesce(sum(t.gross_amount_minor) filter (
          where t.occurred_at >= (select current_start from bounds)), 0) as current_minor,
        coalesce(sum(t.gross_amount_minor) filter (
          where t.occurred_at < (select current_start from bounds)), 0) as previous_minor
      from transactions t
      join commissions c on c.transaction_id = t.id
      where t.workspace_id = ${workspaceId}
        and t.type = 'payment'
        and t.occurred_at >= (select previous_start from bounds)
      group by t.currency
    ),
    commission as (
      -- pending/available use the effective status (see effectiveCommissionStatusSql):
      -- a matured pending commission is already payable, promoted or not.
      select
        currency,
        coalesce(sum(commission_amount_minor) filter (
          where created_at >= (select current_start from bounds)), 0) as current_minor,
        coalesce(sum(commission_amount_minor) filter (
          where ${effectiveCommissionStatusSql()} = 'pending'), 0) as pending_minor,
        coalesce(sum(commission_amount_minor) filter (
          where ${effectiveCommissionStatusSql()} in ('available', 'approved')), 0) as available_minor
      from commissions
      where workspace_id = ${workspaceId} and status <> 'rejected'
      group by currency
    )
    select
      coalesce(r.currency, c.currency) as currency,
      coalesce(r.current_minor, 0)::bigint as revenue_minor,
      coalesce(r.previous_minor, 0)::bigint as revenue_previous_minor,
      coalesce(c.current_minor, 0)::bigint as commission_minor,
      coalesce(c.pending_minor, 0)::bigint as pending_minor,
      coalesce(c.available_minor, 0)::bigint as available_minor
    from revenue r
    full outer join commission c on c.currency = r.currency
  `)

  const pick = (column: Exclude<keyof (typeof money)[number], "currency">) =>
    toMoneyTotals(money.map((row) => ({ currency: row.currency, amountMinor: row[column] })))

  const revenue = pick("revenue_minor")
  const commission = pick("commission_minor")
  const pendingCommission = pick("pending_minor")
  const availableCommission = pick("available_minor")
  const currency = pickPrimaryCurrency(
    counts?.default_currency ?? "USD",
    revenue,
    commission,
    availableCommission,
    pendingCommission,
  )
  const ordered = (totals: MoneyTotal[]) => orderMoneyTotals(totals, currency)

  const clicks = Number(counts?.clicks ?? 0)
  const customers = Number(counts?.customers_acquired ?? 0)

  return {
    currency,
    revenue: ordered(revenue),
    revenuePrevious: ordered(pick("revenue_previous_minor")),
    commission: ordered(commission),
    netRevenue: ordered(subtractMoneyTotals(revenue, commission)),
    activeAffiliates: Number(counts?.active_affiliates ?? 0),
    approvedAffiliates: Number(counts?.approved_affiliates ?? 0),
    hasCommission: Boolean(counts?.has_commission),
    customersAcquired: customers,
    clicks,
    conversionRate: clicks > 0 ? customers / clicks : 0,
    pendingCommission: ordered(pendingCommission),
    availableCommission: ordered(availableCommission),
  }
}

export interface RevenuePoint {
  date: string
  revenueMinor: number
  commissionMinor: number
}

export interface RevenueSeries {
  /** Every point is in this currency; nothing from another currency is added in. */
  currency: string
  points: RevenuePoint[]
  /** Other currencies with revenue or commission in the window, left out of `points`. */
  otherCurrencies: string[]
}

/**
 * Daily revenue and commission in ONE currency. A chart cannot draw BRL and
 * USD on the same axis without converting, so the caller picks the currency
 * (normally `DashboardOverview.currency`) and is told what else was left out.
 * Days are the workspace's local dates (`AnalyticsWindow`).
 */
export async function getRevenueSeries(
  tx: DbClient,
  workspaceId: string,
  currency: string,
  period: AnalyticsWindow,
): Promise<RevenueSeries> {
  const window = resolveWindow(period)
  const firstDay = window.keys[0]!
  const lastDay = window.keys[window.keys.length - 1]!

  const rows = await tx.execute<{
    day: string
    revenue_minor: string
    commission_minor: string
  }>(sql`
    with series as (
      select generate_series(${firstDay}::date::timestamp, ${lastDay}::date::timestamp, interval '1 day')::date as day
    ),
    revenue as (
      select (t.occurred_at at time zone ${window.timeZone}::text)::date as day,
             sum(t.gross_amount_minor) as minor
        from transactions t
        join commissions c on c.transaction_id = t.id
       where t.workspace_id = ${workspaceId}
         and t.type = 'payment'
         and t.currency = ${currency}
         and t.occurred_at >= ${instant(window.start)}
       group by 1
    ),
    commission as (
      select (c.created_at at time zone ${window.timeZone}::text)::date as day,
             sum(c.commission_amount_minor) as minor
        from commissions c
       where c.workspace_id = ${workspaceId}
         and c.status <> 'rejected'
         and c.currency = ${currency}
         and c.created_at >= ${instant(window.start)}
       group by 1
    )
    select
      s.day::text as day,
      coalesce(r.minor, 0)::bigint as revenue_minor,
      coalesce(c.minor, 0)::bigint as commission_minor
    from series s
    left join revenue r on r.day = s.day
    left join commission c on c.day = s.day
    order by s.day
  `)

  const others = await tx.execute<{ currency: string }>(sql`
    with bounds as (select ${instant(window.start)} as start_at)
    select distinct currency from (
      select t.currency
        from transactions t
        join commissions c on c.transaction_id = t.id
       where t.workspace_id = ${workspaceId}
         and t.type = 'payment'
         and t.occurred_at >= (select start_at from bounds)
      union
      select c.currency
        from commissions c
       where c.workspace_id = ${workspaceId}
         and c.status <> 'rejected'
         and c.created_at >= (select start_at from bounds)
    ) present
    where currency <> ${currency}
    order by currency
  `)

  return {
    currency,
    points: rows.map((row) => ({
      date: row.day,
      revenueMinor: Number(row.revenue_minor),
      commissionMinor: Number(row.commission_minor),
    })),
    otherCurrencies: others.map((row) => row.currency.trim()),
  }
}

export interface FunnelStep {
  /** A catalogue key, not a label: the repository does not know the reader. */
  key: "clicks" | "signups" | "trials" | "customers"
  value: number
}

export async function getConversionFunnel(
  tx: DbClient,
  workspaceId: string,
  period: AnalyticsWindow,
): Promise<FunnelStep[]> {
  const window = resolveWindow(period)
  const [row] = await tx.execute<{
    clicks: number
    identified: number
    trials: number
    customers: number
  }>(sql`
    with bounds as (select ${instant(window.start)} as start_at)
    select
      (select count(*) from referral_clicks rc
         join programs p on p.id = rc.program_id
        where p.workspace_id = ${workspaceId}
          and rc.occurred_at >= (select start_at from bounds))::int as clicks,
      (select count(*) from attributions a
         join programs p on p.id = a.program_id
        where p.workspace_id = ${workspaceId}
          and a.customer_external_id is not null
          and a.attributed_at >= (select start_at from bounds))::int as identified,
      (select count(distinct s.id) from subscriptions s
        where s.workspace_id = ${workspaceId}
          and s.started_at >= (select start_at from bounds))::int as trials,
      (select count(distinct c.customer_id) from commissions c
        where c.workspace_id = ${workspaceId}
          and c.commission_amount_minor > 0
          and c.created_at >= (select start_at from bounds))::int as customers
  `)

  return [
    { key: "clicks", value: Number(row?.clicks ?? 0) },
    { key: "signups", value: Number(row?.identified ?? 0) },
    { key: "trials", value: Number(row?.trials ?? 0) },
    { key: "customers", value: Number(row?.customers ?? 0) },
  ]
}

export interface TopAffiliate {
  participationId: string
  affiliateId: string
  name: string
  code: string
  revenueMinor: number
  commissionMinor: number
  customers: number
  currency: string
}

export async function getTopAffiliates(
  tx: DbClient,
  workspaceId: string,
  limit = 5,
): Promise<TopAffiliate[]> {
  const rows = await tx.execute<{
    participation_id: string
    affiliate_id: string
    name: string
    code: string
    revenue_minor: string
    commission_minor: string
    customers: number
    currency: string
  }>(sql`
    select
      c.program_affiliate_id as participation_id,
      a.id as affiliate_id,
      a.name,
      pa.code,
      c.currency,
      sum(c.base_amount_minor)::bigint as revenue_minor,
      sum(c.commission_amount_minor)::bigint as commission_minor,
      count(distinct c.customer_id)::int as customers
    from commissions c
    join program_affiliates pa on pa.id = c.program_affiliate_id
    join affiliates a on a.id = pa.affiliate_id
    where c.workspace_id = ${workspaceId} and c.status <> 'rejected'
    group by c.program_affiliate_id, a.id, a.name, pa.code, c.currency
    order by sum(c.commission_amount_minor) desc
    limit ${limit}
  `)

  return rows.map((row) => ({
    participationId: row.participation_id,
    affiliateId: row.affiliate_id,
    name: row.name,
    code: row.code,
    currency: row.currency,
    revenueMinor: Number(row.revenue_minor),
    commissionMinor: Number(row.commission_minor),
    customers: Number(row.customers),
  }))
}

export interface RecentConversion {
  id: string
  affiliateId: string
  affiliateName: string
  programName: string
  customerRef: string
  currency: string
  amountMinor: number
  commissionMinor: number
  occurredAt: Date
  status: CommissionStatus
}

export type ConversionSortField = "date" | "amount"

export interface ConversionFilters {
  workspaceId: string
  affiliateId?: string
  programId?: string
  /**
   * Payments that occurred at or after this instant. Views inside a workspace
   * resolve it on the workspace's wall clock (`periodStartInZone`).
   */
  from?: Date
}

/** The few newest conversions, for the overview. */
export async function getRecentConversions(
  tx: DbClient,
  workspaceId: string,
  limit = 6,
): Promise<RecentConversion[]> {
  return selectConversions(tx, { workspaceId }, { field: "date", dir: "desc" }, limit, 0)
}

export interface ConversionPage {
  rows: RecentConversion[]
  /** Every conversion matching the filters, not the length of this page. */
  total: number
}

/** The founder's full conversions list, offset-paginated with a hard limit. */
export async function listConversions(
  tx: DbClient,
  params: ConversionFilters & {
    sort?: { field: ConversionSortField; dir: "asc" | "desc" }
    limit?: number
    offset?: number
  },
): Promise<ConversionPage> {
  const limit = Math.min(Math.max(1, params.limit ?? 50), 200)
  const offset = Math.max(0, params.offset ?? 0)
  const sort = params.sort ?? { field: "date", dir: "desc" }

  const rows = await selectConversions(tx, params, sort, limit, offset)
  // Same joins and filters as the page query, so the count can never disagree with the rows.
  const [count] = await tx.execute<{ total: number }>(sql`
    select count(*)::int as total
    ${conversionsFrom(params)}
  `)

  return { rows, total: Number(count?.total ?? 0) }
}

function conversionsFrom(filters: ConversionFilters) {
  return sql`
    from commissions c
    join transactions t on t.id = c.transaction_id
    join customers cu on cu.id = c.customer_id
    join program_affiliates pa on pa.id = c.program_affiliate_id
    join affiliates a on a.id = pa.affiliate_id
    join programs p on p.id = c.program_id
    where c.workspace_id = ${filters.workspaceId}
      ${filters.affiliateId ? sql`and pa.affiliate_id = ${filters.affiliateId}` : sql``}
      ${filters.programId ? sql`and c.program_id = ${filters.programId}` : sql``}
      ${filters.from ? sql`and t.occurred_at >= ${filters.from.toISOString()}` : sql``}
  `
}

async function selectConversions(
  tx: DbClient,
  filters: ConversionFilters,
  sort: { field: ConversionSortField; dir: "asc" | "desc" },
  limit: number,
  offset: number,
): Promise<RecentConversion[]> {
  // Whitelisted columns and directions only: nothing from the URL is spliced in.
  const direction = sort.dir === "asc" ? sql`asc` : sql`desc`
  const order =
    sort.field === "amount"
      ? sql`t.gross_amount_minor ${direction}, t.occurred_at desc, c.id`
      : sql`t.occurred_at ${direction}, c.id`

  const rows = await tx.execute<{
    id: string
    affiliate_id: string
    affiliate_name: string
    program_name: string
    customer_ref: string
    currency: string
    amount_minor: string
    commission_minor: string
    occurred_at: string
    status: CommissionStatus
  }>(sql`
    select
      c.id,
      a.id as affiliate_id,
      a.name as affiliate_name,
      p.name as program_name,
      coalesce(cu.external_id, cu.provider_customer_id, left(cu.id::text, 8)) as customer_ref,
      c.currency,
      t.gross_amount_minor::bigint as amount_minor,
      c.commission_amount_minor::bigint as commission_minor,
      t.occurred_at,
      ${effectiveCommissionStatusSql("c")}::text as status
    ${conversionsFrom(filters)}
    order by ${order}
    limit ${limit}
    offset ${offset}
  `)

  return rows.map((row) => ({
    id: row.id,
    affiliateId: row.affiliate_id,
    affiliateName: row.affiliate_name,
    programName: row.program_name,
    customerRef: row.customer_ref,
    currency: row.currency.trim(),
    amountMinor: Number(row.amount_minor),
    commissionMinor: Number(row.commission_minor),
    occurredAt: new Date(row.occurred_at),
    status: row.status,
  }))
}

export interface AffiliateSeriesPoint {
  date: string
  clicks: number
  commissionMinor: number
}

/**
 * The affiliate portal's daily series. Days are UTC dates on purpose: one
 * affiliate may earn in several workspaces, each in its own zone, and the
 * portal has no single workspace clock to follow.
 */
export async function getAffiliateSeries(
  tx: DbClient,
  participationIds: string[],
  days = 30,
): Promise<AffiliateSeriesPoint[]> {
  if (participationIds.length === 0) return []

  // `sql.param` is required around the id list: interpolating an array directly
  // renders it as a row constructor — `($1, $2)` — which is not an array, and
  // for a single participation `($1)::uuid[]` fails outright with 22P02.
  const rows = await tx.execute<{ day: string; clicks: number; commission_minor: string }>(sql`
    with series as (
      select generate_series(
        date_trunc('day', now() - make_interval(days => ${days - 1})),
        date_trunc('day', now()),
        interval '1 day'
      )::date as day
    ),
    ids as (select unnest(${sql.param(participationIds)}::uuid[]) as id)
    select
      s.day::text as day,
      coalesce((select count(*) from referral_clicks rc
         where rc.program_affiliate_id in (select id from ids)
           and date_trunc('day', rc.occurred_at)::date = s.day), 0)::int as clicks,
      coalesce((select sum(c.commission_amount_minor) from commissions c
         where c.program_affiliate_id in (select id from ids)
           and c.status <> 'rejected'
           and date_trunc('day', c.created_at)::date = s.day), 0)::bigint as commission_minor
    from series s
    order by s.day
  `)

  return rows.map((row) => ({
    date: row.day,
    clicks: Number(row.clicks),
    commissionMinor: Number(row.commission_minor),
  }))
}
