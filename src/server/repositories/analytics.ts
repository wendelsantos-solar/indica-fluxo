import "server-only"

import { sql, type SQL } from "drizzle-orm"

import {
  orderMoneyTotals,
  pickPrimaryCurrency,
  subtractMoneyTotals,
  toMoneyTotals,
  type MoneyTotal,
} from "@/lib/money-totals"
import { localDayRange, resolveTimeZone, type LocalDayRange } from "@/lib/time-zone"
import type { ViewEnvironment } from "@/lib/view-environment"
import { type DbClient } from "@/server/db"
import {
  commissionInEnvironment,
  effectiveCommissionStatusSql,
  payableCommissionFilter,
  type CommissionStatus,
} from "@/server/repositories/commissions"

/**
 * Read models. These never hydrate entities: every figure is aggregated in
 * Postgres and only the columns a view renders come back. See ARCHITECTURE.md §6.
 *
 * Every workspace read takes a `ViewEnvironment`: the dashboard shows test or
 * live data, never both summed (docs/PLANS.md §2). Clicks, attributions and
 * commissions are filtered through their program's `environment`;
 * transactions and customers through their own column.
 *
 * Definitions shared by the overview's figures and its chart:
 *
 * - **Revenue** (“Receita indicada”) is the money referred customers actually
 *   paid: payments that earned a (not rejected) commission, minus the refunds
 *   and chargebacks of those payments. Each row counts on its own
 *   `occurred_at`, so a refund lowers the period it happened in. A payment
 *   recorded twice (the PaymentIntent and the invoice event before their link,
 *   see `billing-events.ts` “One payment, one commission”) is reversed by a
 *   `dup_<id>` adjustment; the duplicate and its adjustment are both left out,
 *   so the kept record counts once.
 * - **Commissions in a period** sum the ledger rows (reversals included, so
 *   they net) whose payment, refund or adjustment `occurred_at` falls in the
 *   period — the same clock as revenue, so “revenue after commissions” never
 *   subtracts one month's commissions from another month's revenue. The same
 *   duplicate records are left out.
 * - **Ready to pay** is what a payout batch can claim right now
 *   (`payableCommissionFilter`): available, not held by a batch. Commissions
 *   already in a batch awaiting payment are not “ready”.
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

/**
 * The transaction aliased `alias` is one of the two records of a duplicated
 * payment that `reverseDuplicatePayment` cancelled out: the `dup_` adjustment
 * itself, or the payment it reversed.
 */
function duplicateRecordSql(alias: string): SQL {
  const t = sql.identifier(alias)
  return sql`(
    (${t}.type = 'adjustment' and left(${t}.provider_transaction_id, 4) = 'dup_')
    or (${t}.type = 'payment' and exists (
      select 1 from transactions dup
       where dup.workspace_id = ${t}.workspace_id
         and dup.provider = ${t}.provider
         and dup.type = 'adjustment'
         and dup.provider_transaction_id = 'dup_' || ${t}.provider_transaction_id)))`
}

/** The payment aliased `alias` earned a commission that still stands in the ledger. */
function commissionedPaymentSql(alias: string): SQL {
  const t = sql.identifier(alias)
  return sql`(${t}.type = 'payment' and exists (
    select 1 from commissions earned
     where earned.transaction_id = ${t}.id
       and earned.reversal_of_commission_id is null
       and earned.status <> 'rejected'))`
}

/**
 * Referred money, one row per transaction: `currency`, `occurred_at`,
 * `customer_id`, `type` and the signed `minor` amount (see “Revenue” above).
 * `extra` narrows further (currency, lower bound).
 */
function referredMoneySql(workspaceId: string, environment: ViewEnvironment, extra: SQL = sql``): SQL {
  return sql`
    select t.currency, t.occurred_at, t.customer_id, t.type, t.gross_amount_minor as minor
      from transactions t
     where t.workspace_id = ${workspaceId}
       and t.environment = ${environment}
       and not ${duplicateRecordSql("t")}
       and (
         ${commissionedPaymentSql("t")}
         or (t.type in ('refund', 'chargeback') and exists (
           select 1 from transactions paid
            where paid.workspace_id = t.workspace_id
              and paid.provider = t.provider
              and paid.provider_transaction_id = t.provider_parent_transaction_id
              and ${commissionedPaymentSql("paid")}
              and not ${duplicateRecordSql("paid")}))
       )
       ${extra}
  `
}

/**
 * Commission rows of `environment` with the `occurred_at` of the money
 * movement behind them (see “Commissions in a period” above), aliased `c`/`t`.
 */
function commissionLedgerSql(workspaceId: string, environment: ViewEnvironment, extra: SQL = sql``): SQL {
  return sql`
    select c.currency, c.commission_amount_minor as minor, t.occurred_at
      from commissions c
      join transactions t on t.id = c.transaction_id
      join programs p on p.id = c.program_id
     where c.workspace_id = ${workspaceId}
       and p.environment = ${environment}
       and c.status <> 'rejected'
       and not ${duplicateRecordSql("t")}
       ${extra}
  `
}

/** Whether the workspace holds any live program — `resolveViewEnvironment`'s input. */
export async function workspaceHasLivePrograms(tx: DbClient, workspaceId: string): Promise<boolean> {
  const { rows: [row] } = await tx.execute<{ found: boolean }>(sql`
    select exists (
      select 1 from programs where workspace_id = ${workspaceId} and environment = 'live'
    ) as found
  `)
  return Boolean(row?.found)
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
  /** On hold: effective `pending`, all time. */
  pendingCommission: MoneyTotal[]
  /** Ready to pay: what a new payout batch could claim now, all time. */
  availableCommission: MoneyTotal[]
}

export async function getDashboardOverview(
  tx: DbClient,
  workspaceId: string,
  environment: ViewEnvironment,
  period: AnalyticsWindow,
): Promise<DashboardOverview> {
  const window = resolveWindow(period)
  const start = instant(window.start)

  // Independent statements, sent together (pipelined on the transaction's connection).
  const [{ rows: [counts] }, { rows: money }] = await Promise.all([
    tx.execute<{
      default_currency: string | null
      active_affiliates: number
      approved_affiliates: number
      has_commission: boolean
      customers_acquired: number
      clicks: number
    }>(sql`
      select
        (select default_currency from workspaces where id = ${workspaceId}) as default_currency,
        (select count(distinct pa.id)
           from program_affiliates pa
           join programs p on p.id = pa.program_id
          where p.workspace_id = ${workspaceId}
            and p.environment = ${environment}
            and pa.status = 'approved')::int as approved_affiliates,
        (select count(distinct pa.id)
           from program_affiliates pa
           join programs p on p.id = pa.program_id
          where p.workspace_id = ${workspaceId}
            and p.environment = ${environment}
            and pa.status = 'approved'
            and (
              exists (select 1 from referral_clicks rc
                       where rc.program_affiliate_id = pa.id
                         and rc.occurred_at >= ${start})
              or exists (select 1 from commissions c
                           join transactions t on t.id = c.transaction_id
                          where c.program_affiliate_id = pa.id
                            and c.status <> 'rejected'
                            and t.occurred_at >= ${start})
            ))::int as active_affiliates,
        exists (select 1 from commissions c
                  join programs p on p.id = c.program_id
                 where c.workspace_id = ${workspaceId}
                   and p.environment = ${environment}
                   and c.status <> 'rejected') as has_commission,
        (select count(distinct referred.customer_id)
           from (${referredMoneySql(workspaceId, environment, sql`and t.occurred_at >= ${start}`)}) referred
          where referred.type = 'payment')::int as customers_acquired,
        (select count(*)
           from referral_clicks rc
           join programs p on p.id = rc.program_id
          where p.workspace_id = ${workspaceId}
            and p.environment = ${environment}
            and rc.occurred_at >= ${start})::int as clicks
    `),

    // One row per currency. Sums are `bigint` (int4 overflows at 21 474 836,47)
    // and come back from the driver as strings, hence the `Number` below.
    tx.execute<{
      currency: string
      revenue_minor: string
      revenue_previous_minor: string
      commission_minor: string
      pending_minor: string
      available_minor: string
    }>(sql`
      with bounds as (
        select ${start} as current_start, ${instant(window.previousStart)} as previous_start
      ),
      revenue as (
        select
          currency,
          coalesce(sum(minor) filter (where occurred_at >= (select current_start from bounds)), 0) as current_minor,
          coalesce(sum(minor) filter (where occurred_at < (select current_start from bounds)), 0) as previous_minor
        from (${referredMoneySql(workspaceId, environment, sql`and t.occurred_at >= ${instant(window.previousStart)}`)}) referred
        group by currency
      ),
      commission as (
        select currency, coalesce(sum(minor), 0) as current_minor
          from (${commissionLedgerSql(workspaceId, environment, sql`and t.occurred_at >= ${start}`)}) ledger
         group by currency
      ),
      hold as (
        -- Effective status (see effectiveCommissionStatusSql): a matured pending
        -- commission is already payable, promoted or not.
        select c.currency, coalesce(sum(c.commission_amount_minor), 0) as minor
          from commissions c
          join programs p on p.id = c.program_id
         where c.workspace_id = ${workspaceId}
           and p.environment = ${environment}
           and ${effectiveCommissionStatusSql("c")} = 'pending'
         group by c.currency
      ),
      payable as (
        -- The payouts page's own rule and grouping: a participation owed a
        -- positive amount in a currency, not already held by a batch.
        select currency, sum(owed) as minor
          from (
            select commissions.currency, sum(commissions.commission_amount_minor) as owed
              from commissions
             where commissions.workspace_id = ${workspaceId}
               and ${commissionInEnvironment(environment)}
               and ${payableCommissionFilter()}
             group by commissions.program_affiliate_id, commissions.currency
            having sum(commissions.commission_amount_minor) > 0
          ) per_affiliate
         group by currency
      ),
      currencies as (
        select currency from revenue
        union select currency from commission
        union select currency from hold
        union select currency from payable
      )
      select
        k.currency,
        coalesce(r.current_minor, 0)::bigint as revenue_minor,
        coalesce(r.previous_minor, 0)::bigint as revenue_previous_minor,
        coalesce(c.current_minor, 0)::bigint as commission_minor,
        coalesce(h.minor, 0)::bigint as pending_minor,
        coalesce(pay.minor, 0)::bigint as available_minor
      from currencies k
      left join revenue r on r.currency = k.currency
      left join commission c on c.currency = k.currency
      left join hold h on h.currency = k.currency
      left join payable pay on pay.currency = k.currency
    `),
  ])

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
 * Daily revenue and commission in ONE currency, with the overview's
 * definitions. A chart cannot draw BRL and USD on the same axis without
 * converting, so the caller picks the currency (normally
 * `DashboardOverview.currency`) and is told what else was left out. Days are
 * the workspace's local dates (`AnalyticsWindow`).
 */
export async function getRevenueSeries(
  tx: DbClient,
  workspaceId: string,
  environment: ViewEnvironment,
  currency: string,
  period: AnalyticsWindow,
): Promise<RevenueSeries> {
  const window = resolveWindow(period)
  const firstDay = window.keys[0]!
  const lastDay = window.keys[window.keys.length - 1]!
  const start = instant(window.start)

  const { rows } = await tx.execute<{
    day: string
    revenue_minor: string
    commission_minor: string
  }>(sql`
    with series as (
      select generate_series(${firstDay}::date::timestamp, ${lastDay}::date::timestamp, interval '1 day')::date as day
    ),
    revenue as (
      select (occurred_at at time zone ${window.timeZone}::text)::date as day, sum(minor) as minor
        from (${referredMoneySql(workspaceId, environment, sql`and t.currency = ${currency} and t.occurred_at >= ${start}`)}) referred
       group by 1
    ),
    commission as (
      select (occurred_at at time zone ${window.timeZone}::text)::date as day, sum(minor) as minor
        from (${commissionLedgerSql(workspaceId, environment, sql`and c.currency = ${currency} and t.occurred_at >= ${start}`)}) ledger
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

  const { rows: others } = await tx.execute<{ currency: string }>(sql`
    select distinct currency from (
      select currency from (${referredMoneySql(workspaceId, environment, sql`and t.occurred_at >= ${start}`)}) referred
      union
      select currency from (${commissionLedgerSql(workspaceId, environment, sql`and t.occurred_at >= ${start}`)}) ledger
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

/**
 * - clicks: referral clicks in the period.
 * - signups: attributions bound to a customer id by identify in the period.
 * - trials: subscriptions started in the period by a *referred* customer — one
 *   attached to a program (it earned a commission) or matching an attribution
 *   of this environment. A founder's other subscribers are not the program's.
 * - customers: distinct referred customers who paid in the period — the
 *   overview's `customersAcquired`.
 */
export async function getConversionFunnel(
  tx: DbClient,
  workspaceId: string,
  environment: ViewEnvironment,
  period: AnalyticsWindow,
): Promise<FunnelStep[]> {
  const window = resolveWindow(period)
  const start = instant(window.start)
  const { rows: [row] } = await tx.execute<{
    clicks: number
    identified: number
    trials: number
    customers: number
  }>(sql`
    select
      (select count(*) from referral_clicks rc
         join programs p on p.id = rc.program_id
        where p.workspace_id = ${workspaceId}
          and p.environment = ${environment}
          and rc.occurred_at >= ${start})::int as clicks,
      (select count(*) from attributions a
         join programs p on p.id = a.program_id
        where p.workspace_id = ${workspaceId}
          and p.environment = ${environment}
          and a.customer_external_id is not null
          and a.attributed_at >= ${start})::int as identified,
      (select count(distinct s.id) from subscriptions s
         join customers cu on cu.id = s.customer_id
        where s.workspace_id = ${workspaceId}
          and cu.environment = ${environment}
          and s.started_at >= ${start}
          and (
            cu.program_id is not null
            or exists (
              select 1 from attributions a
                join programs p on p.id = a.program_id
               where p.workspace_id = ${workspaceId}
                 and p.environment = ${environment}
                 and ((cu.external_id is not null and a.customer_external_id = cu.external_id)
                   or (cu.provider_customer_id is not null and a.provider_customer_id = cu.provider_customer_id)))
          ))::int as trials,
      (select count(distinct referred.customer_id)
         from (${referredMoneySql(workspaceId, environment, sql`and t.occurred_at >= ${start}`)}) referred
        where referred.type = 'payment')::int as customers
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

/** All-time, by commission. Reversal rows net out (their base and commission are negative). */
export async function getTopAffiliates(
  tx: DbClient,
  workspaceId: string,
  environment: ViewEnvironment,
  limit = 5,
): Promise<TopAffiliate[]> {
  const { rows } = await tx.execute<{
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
      (count(distinct c.customer_id) filter (where c.commission_amount_minor > 0))::int as customers
    from commissions c
    join program_affiliates pa on pa.id = c.program_affiliate_id
    join affiliates a on a.id = pa.affiliate_id
    join programs p on p.id = c.program_id
    where c.workspace_id = ${workspaceId}
      and p.environment = ${environment}
      and c.status <> 'rejected'
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
  /** Only conversions of programs in this environment. */
  environment: ViewEnvironment
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
  environment: ViewEnvironment,
  limit = 6,
): Promise<RecentConversion[]> {
  return selectConversions(tx, { workspaceId, environment }, { field: "date", dir: "desc" }, limit, 0)
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
  const { rows: [count] } = await tx.execute<{ total: number }>(sql`
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
      and p.environment = ${filters.environment}
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

  const { rows } = await tx.execute<{
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
 * portal has no single workspace clock to follow. UTC is spelled out in SQL
 * (`at time zone 'UTC'`) rather than left to the session's `TimeZone`, which
 * `date_trunc` on a `timestamptz` would silently follow.
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
  const { rows } = await tx.execute<{ day: string; clicks: number; commission_minor: string }>(sql`
    with today as (select (now() at time zone 'UTC')::date as day),
    series as (
      select generate_series(
        ((select day from today) - ${days - 1}::int)::timestamp,
        (select day from today)::timestamp,
        interval '1 day'
      )::date as day
    ),
    ids as (select unnest(${sql.param(participationIds)}::uuid[]) as id),
    clicks as (
      select (rc.occurred_at at time zone 'UTC')::date as day, count(*)::int as clicks
        from referral_clicks rc
       where rc.program_affiliate_id in (select id from ids)
         and rc.occurred_at >= ((select day from today) - ${days - 1}::int)::timestamp at time zone 'UTC'
       group by 1
    ),
    earned as (
      select (c.created_at at time zone 'UTC')::date as day, sum(c.commission_amount_minor) as minor
        from commissions c
       where c.program_affiliate_id in (select id from ids)
         and c.status <> 'rejected'
         and c.created_at >= ((select day from today) - ${days - 1}::int)::timestamp at time zone 'UTC'
       group by 1
    )
    select
      s.day::text as day,
      coalesce(clicks.clicks, 0)::int as clicks,
      coalesce(earned.minor, 0)::bigint as commission_minor
    from series s
    left join clicks on clicks.day = s.day
    left join earned on earned.day = s.day
    order by s.day
  `)

  return rows.map((row) => ({
    date: row.day,
    clicks: Number(row.clicks),
    commissionMinor: Number(row.commission_minor),
  }))
}
