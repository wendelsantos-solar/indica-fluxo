import "server-only"

import { sql } from "drizzle-orm"

import { type DbClient } from "@/server/db"

/**
 * Read models. These never hydrate entities: every figure is aggregated in
 * Postgres and only the columns a view renders come back. See ARCHITECTURE.md §6.
 */

export interface DashboardOverview {
  currency: string
  revenueMinor: number
  revenuePreviousMinor: number
  commissionMinor: number
  netRevenueMinor: number
  activeAffiliates: number
  customersAcquired: number
  clicks: number
  conversionRate: number
  pendingCommissionMinor: number
  availableCommissionMinor: number
}

export async function getDashboardOverview(
  tx: DbClient,
  workspaceId: string,
  days = 30,
): Promise<DashboardOverview> {
  const [row] = await tx.execute<{
    currency: string
    revenue_minor: number
    revenue_previous_minor: number
    commission_minor: number
    active_affiliates: number
    customers_acquired: number
    clicks: number
    pending_commission_minor: number
    available_commission_minor: number
  }>(sql`
    with bounds as (
      select
        now() - make_interval(days => ${days}) as current_start,
        now() - make_interval(days => ${days * 2}) as previous_start,
        now() - make_interval(days => ${days}) as previous_end
    ),
    ws as (
      select default_currency from workspaces where id = ${workspaceId}
    ),
    revenue as (
      select
        coalesce(sum(t.gross_amount_minor) filter (
          where t.occurred_at >= (select current_start from bounds)), 0) as current_minor,
        coalesce(sum(t.gross_amount_minor) filter (
          where t.occurred_at >= (select previous_start from bounds)
            and t.occurred_at < (select previous_end from bounds)), 0) as previous_minor,
        count(distinct t.customer_id) filter (
          where t.occurred_at >= (select current_start from bounds)) as customers
      from transactions t
      join commissions c on c.transaction_id = t.id
      where t.workspace_id = ${workspaceId}
        and t.type = 'payment'
    ),
    commission as (
      select
        coalesce(sum(commission_amount_minor) filter (
          where created_at >= (select current_start from bounds)), 0) as current_minor,
        coalesce(sum(commission_amount_minor) filter (where status = 'pending'), 0) as pending_minor,
        coalesce(sum(commission_amount_minor) filter (
          where status in ('available','approved')), 0) as available_minor
      from commissions
      where workspace_id = ${workspaceId} and status <> 'rejected'
    ),
    affiliate_count as (
      select count(distinct pa.id) as value
      from program_affiliates pa
      join programs p on p.id = pa.program_id
      where p.workspace_id = ${workspaceId} and pa.status = 'approved'
    ),
    click_count as (
      select count(*) as value
      from referral_clicks rc
      join programs p on p.id = rc.program_id
      where p.workspace_id = ${workspaceId}
        and rc.occurred_at >= (select current_start from bounds)
    )
    select
      (select default_currency from ws) as currency,
      (select current_minor from revenue)::bigint as revenue_minor,
      (select previous_minor from revenue)::bigint as revenue_previous_minor,
      (select current_minor from commission)::bigint as commission_minor,
      (select value from affiliate_count)::int as active_affiliates,
      (select customers from revenue)::int as customers_acquired,
      (select value from click_count)::int as clicks,
      (select pending_minor from commission)::bigint as pending_commission_minor,
      (select available_minor from commission)::bigint as available_commission_minor
  `)

  const revenue = Number(row?.revenue_minor ?? 0)
  const commission = Number(row?.commission_minor ?? 0)
  const clicks = Number(row?.clicks ?? 0)
  const customers = Number(row?.customers_acquired ?? 0)

  return {
    currency: row?.currency ?? "USD",
    revenueMinor: revenue,
    revenuePreviousMinor: Number(row?.revenue_previous_minor ?? 0),
    commissionMinor: commission,
    netRevenueMinor: revenue - commission,
    activeAffiliates: Number(row?.active_affiliates ?? 0),
    customersAcquired: customers,
    clicks,
    conversionRate: clicks > 0 ? customers / clicks : 0,
    pendingCommissionMinor: Number(row?.pending_commission_minor ?? 0),
    availableCommissionMinor: Number(row?.available_commission_minor ?? 0),
  }
}

export interface RevenuePoint {
  date: string
  revenueMinor: number
  commissionMinor: number
}

export async function getRevenueSeries(
  tx: DbClient,
  workspaceId: string,
  days = 30,
): Promise<RevenuePoint[]> {
  const rows = await tx.execute<{
    day: string
    revenue_minor: number
    commission_minor: number
  }>(sql`
    with series as (
      select generate_series(
        date_trunc('day', now() - make_interval(days => ${days - 1})),
        date_trunc('day', now()),
        interval '1 day'
      )::date as day
    )
    select
      s.day::text as day,
      coalesce((
        select sum(t.gross_amount_minor)
          from transactions t
          join commissions c on c.transaction_id = t.id
         where t.workspace_id = ${workspaceId}
           and t.type = 'payment'
           and date_trunc('day', t.occurred_at)::date = s.day
      ), 0)::bigint as revenue_minor,
      coalesce((
        select sum(c.commission_amount_minor)
          from commissions c
         where c.workspace_id = ${workspaceId}
           and c.status <> 'rejected'
           and date_trunc('day', c.created_at)::date = s.day
      ), 0)::bigint as commission_minor
    from series s
    order by s.day
  `)

  return rows.map((row) => ({
    date: row.day,
    revenueMinor: Number(row.revenue_minor),
    commissionMinor: Number(row.commission_minor),
  }))
}

export interface FunnelStep {
  /** A catalogue key, not a label: the repository does not know the reader. */
  key: "clicks" | "signups" | "trials" | "customers"
  value: number
}

export async function getConversionFunnel(
  tx: DbClient,
  workspaceId: string,
  days = 30,
): Promise<FunnelStep[]> {
  const [row] = await tx.execute<{
    clicks: number
    identified: number
    trials: number
    customers: number
  }>(sql`
    with bounds as (select now() - make_interval(days => ${days}) as start_at)
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
    name: string
    code: string
    revenue_minor: number
    commission_minor: number
    customers: number
    currency: string
  }>(sql`
    select
      c.program_affiliate_id as participation_id,
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
    group by c.program_affiliate_id, a.name, pa.code, c.currency
    order by sum(c.commission_amount_minor) desc
    limit ${limit}
  `)

  return rows.map((row) => ({
    participationId: row.participation_id,
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
  affiliateName: string
  customerRef: string
  currency: string
  amountMinor: number
  commissionMinor: number
  occurredAt: Date
  status: string
}

export async function getRecentConversions(
  tx: DbClient,
  workspaceId: string,
  limit = 6,
): Promise<RecentConversion[]> {
  const rows = await tx.execute<{
    id: string
    affiliate_name: string
    customer_ref: string
    currency: string
    amount_minor: number
    commission_minor: number
    occurred_at: string
    status: string
  }>(sql`
    select
      c.id,
      a.name as affiliate_name,
      coalesce(cu.external_id, cu.provider_customer_id, left(cu.id::text, 8)) as customer_ref,
      c.currency,
      t.gross_amount_minor::bigint as amount_minor,
      c.commission_amount_minor::bigint as commission_minor,
      t.occurred_at,
      c.status::text
    from commissions c
    join transactions t on t.id = c.transaction_id
    join customers cu on cu.id = c.customer_id
    join program_affiliates pa on pa.id = c.program_affiliate_id
    join affiliates a on a.id = pa.affiliate_id
    where c.workspace_id = ${workspaceId}
    order by t.occurred_at desc
    limit ${limit}
  `)

  return rows.map((row) => ({
    id: row.id,
    affiliateName: row.affiliate_name,
    customerRef: row.customer_ref,
    currency: row.currency,
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

export async function getAffiliateSeries(
  tx: DbClient,
  participationIds: string[],
  days = 30,
): Promise<AffiliateSeriesPoint[]> {
  if (participationIds.length === 0) return []

  // `sql.param` is required around the id list: interpolating an array directly
  // renders it as a row constructor — `($1, $2)` — which is not an array, and
  // for a single participation `($1)::uuid[]` fails outright with 22P02.
  const rows = await tx.execute<{ day: string; clicks: number; commission_minor: number }>(sql`
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
