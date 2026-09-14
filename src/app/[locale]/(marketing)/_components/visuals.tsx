import {
  Check,
  ChartNoAxesColumn,
  Coins,
  Copy,
  CreditCard,
  Layers,
  type LucideIcon,
  MousePointerClick,
  Receipt,
  Search,
  Settings2,
  Users,
} from "lucide-react"
import { getLocale, getTranslations } from "next-intl/server"
import type * as React from "react"

import { getFormatters } from "@/i18n/format"
import { DEFAULT_CURRENCY, type Locale } from "@/i18n/routing"
import { StatusBadge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { cn, initials } from "@/lib/utils"

/*
 * Product visuals for the landing. Every one is built from the app's own
 * tokens and primitives — never a screenshot, never an illustration — so the
 * page cannot drift from what a founder sees after signing up. They are
 * decorative: hidden from assistive technology and free of focusable elements
 * (a "button" is a styled span). Names, codes and amounts are sample data, not
 * interface copy.
 */

async function money() {
  const f = await getFormatters()
  const locale = (await getLocale()) as Locale
  const currency = DEFAULT_CURRENCY[locale]
  return { f, locale, format: (minor: number) => f.money(minor, currency) }
}

/** A framed piece of the product: hairline, panel radius, surface-1. */
export function Frame({
  className,
  children,
  label,
}: {
  className?: string
  children: React.ReactNode
  /** Optional title bar text, like a page header in the app. */
  label?: string
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "select-none overflow-hidden rounded-panel border border-border bg-surface-1",
        className,
      )}
    >
      {label ? (
        <div className="flex h-10 items-center border-b border-border px-4 text-caption font-medium text-foreground">
          {label}
        </div>
      ) : null}
      {children}
    </div>
  )
}

/** Deterministic daily revenue, shaped like a channel that is picking up. */
const SERIES = [
  32, 28, 35, 30, 41, 38, 36, 44, 40, 47, 43, 52, 49, 46, 55, 58, 51, 60, 57, 63, 61, 68, 64, 70, 67, 74,
  72, 79, 76, 84,
]

function AreaChart({ className, points = SERIES }: { className?: string; points?: number[] }) {
  const width = 600
  const height = 160
  const max = Math.max(...points) * 1.1
  const step = width / (points.length - 1)
  const coords = points.map((value, index) => [index * step, height - (value / max) * height] as const)
  const line = coords.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ")
  const area = `${line} L${width} ${height} L0 ${height} Z`

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("h-full w-full text-chart-1", className)}
    >
      <defs>
        <linearGradient id="landing-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((ratio) => (
        <line
          key={ratio}
          x1="0"
          x2={width}
          y1={height * ratio}
          y2={height * ratio}
          className="stroke-border"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path d={area} fill="url(#landing-area)" />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

const TOP_AFFILIATES = [
  { name: "Marina Costa", customers: 18, commission: 268380 },
  { name: "Agency Labs", customers: 11, commission: 197010 },
  { name: "Studio Norte", customers: 7, commission: 125370 },
  { name: "João Pereira", customers: 5, commission: 59100 },
] as const

/** The hero: the founder overview inside the real app frame. */
export async function HeroPreview() {
  const t = await getTranslations("marketing.preview")
  const nav = await getTranslations("nav")
  const { f, locale, format } = await money()

  const percent = (value: number) =>
    new Intl.NumberFormat(locale, { style: "percent", signDisplay: "always", maximumFractionDigits: 1 }).format(value)

  const sections: { key: string; label?: string; items: { label: string; icon: LucideIcon; active?: boolean }[] }[] = [
    { key: "home", items: [{ label: nav("overview"), icon: ChartNoAxesColumn, active: true }] },
    {
      key: "growth",
      label: nav("sections.growth"),
      items: [
        { label: nav("programs"), icon: Layers },
        { label: nav("affiliates"), icon: Users },
      ],
    },
    {
      key: "ledger",
      label: nav("sections.ledger"),
      items: [
        { label: nav("conversions"), icon: Receipt },
        { label: nav("commissions"), icon: Coins },
        { label: nav("payouts"), icon: CreditCard },
      ],
    },
  ]

  const metrics = [
    { key: "revenue", value: format(1843020), delta: percent(0.234) },
    { key: "commissions", value: format(552906), delta: percent(0.191) },
    { key: "customers", value: f.number(41), delta: percent(0.17) },
    { key: "affiliates", value: f.number(34), delta: null },
  ] as const

  return (
    <div aria-hidden="true" className="relative select-none">
      <div className="flex overflow-hidden rounded-panel border border-border bg-background p-1.5 sm:p-2">
        <div className="hidden w-52 shrink-0 flex-col pr-2 md:flex">
          <div className="flex h-11 items-center gap-2 px-1.5">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-badge bg-inverse text-micro text-inverse-foreground">
              {initials("Acme SaaS")}
            </span>
            <span className="min-w-0 flex-1 truncate text-caption font-semibold text-foreground">Acme SaaS</span>
          </div>
          <div className="pb-2">
            <div className="flex h-8 items-center gap-2.5 rounded-control border border-border bg-fill-subtle px-2 text-caption text-faint-foreground">
              <Search className="size-3.5 shrink-0" />
              <span className="flex-1">{nav("search")}</span>
              <Kbd>⌘K</Kbd>
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-4 pt-2">
            {sections.map((section) => (
              <div key={section.key} className="flex flex-col gap-px">
                {section.label ? <p className="px-2 pb-1 text-meta text-faint-foreground">{section.label}</p> : null}
                {section.items.map((item) => (
                  <span
                    key={item.label}
                    className={cn(
                      "flex h-8 items-center gap-2.5 rounded-control px-2 text-caption font-medium",
                      item.active ? "bg-selected text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <item.icon className="size-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-border-faint pt-2">
            <span className="flex h-8 items-center gap-2.5 rounded-control px-2 text-caption font-medium text-muted-foreground">
              <Settings2 className="size-4 shrink-0" />
              {nav("settings")}
            </span>
          </div>
        </div>

        <div className="min-w-0 flex-1 overflow-hidden rounded-panel border border-border bg-surface-1">
          <div className="flex h-12 items-center gap-3 border-b border-border px-4 sm:px-5">
            <span className="text-caption font-medium text-foreground">{t("overview")}</span>
            <span className="hidden text-caption text-muted-foreground sm:inline">{t("period")}</span>
            <span className={cn(buttonVariants({ variant: "primary", size: "sm" }), "ml-auto")}>{t("invite")}</span>
          </div>

          <div className="px-4 sm:px-5">
            <div className="grid grid-cols-2 gap-x-6 border-b border-border lg:grid-cols-4">
              {metrics.map((metric, index) => (
                <div key={metric.key} className={cn("min-w-0 space-y-1 py-4", index > 1 && "hidden lg:block")}>
                  <p className="truncate text-caption text-muted-foreground">{t(`metrics.${metric.key}`)}</p>
                  <p
                    className={cn(
                      "whitespace-nowrap tabular-nums text-foreground",
                      index === 0 ? "text-title sm:text-subheading" : "text-title",
                    )}
                  >
                    {metric.value}
                  </p>
                  {metric.delta ? (
                    <p className="text-meta tabular-nums text-success-foreground">{metric.delta}</p>
                  ) : (
                    <p className="text-meta text-muted-foreground">&nbsp;</p>
                  )}
                </div>
              ))}
            </div>

            <div className="grid gap-6 py-5 lg:grid-cols-[1.5fr_1fr]">
              <div className="min-w-0">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-caption font-medium text-foreground">{t("chart")}</p>
                  <p className="text-meta text-muted-foreground">{t("comparison")}</p>
                </div>
                <div className="h-36 sm:h-44">
                  <AreaChart />
                </div>
              </div>
              <div className="hidden min-w-0 sm:block">
                <p className="mb-2 text-caption font-medium text-foreground">{t("topAffiliates")}</p>
                <ul className="border-t border-border">
                  {TOP_AFFILIATES.map((row) => (
                    <li key={row.name} className="flex h-11 items-center gap-2.5 border-b border-border-faint last:border-0">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-fill-strong text-micro text-foreground-secondary">
                        {initials(row.name)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-caption text-foreground">{row.name}</span>
                      <span className="text-caption tabular-nums text-foreground-secondary">{format(row.commission)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      <NewConversionNotice className="absolute -bottom-8 right-6 hidden w-72 sm:block lg:right-10" />
    </div>
  )
}

/** The moment the product exists for: a referral became money. */
export async function NewConversionNotice({ className }: { className?: string }) {
  const t = await getTranslations("marketing.preview")
  const { format } = await money()
  return (
    <div className={cn("rounded-panel bg-surface-3 p-3 shadow-overlay", className)}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-control bg-success-subtle text-success-foreground">
          <Check className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-caption font-medium text-foreground">{t("notice.title")}</p>
          <p className="text-meta text-muted-foreground">{t("notice.detail", { name: "Marina Costa" })}</p>
          <p className="mt-1 text-caption tabular-nums text-foreground">
            {t("notice.commission", { amount: `+${format(14910)}` })}
          </p>
        </div>
      </div>
    </div>
  )
}

/** Step 1 — Stripe connected. */
export async function StripeVisual() {
  const t = await getTranslations("marketing.preview")
  const status = await getTranslations("status")
  return (
    <Frame>
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="flex size-8 items-center justify-center rounded-control bg-inverse text-caption font-semibold text-inverse-foreground">
          S
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-caption font-medium text-foreground">Stripe</p>
          <p className="text-meta text-muted-foreground">{t("stripe.account")} · acct_1Q8xK2Lm</p>
        </div>
        <span className="inline-flex h-5 items-center gap-1.5 rounded-badge border border-border px-1.5 text-meta font-medium text-foreground-secondary">
          <span className="size-1.5 rounded-full bg-success" />
          {status("connected")}
        </span>
      </div>
      <dl className="divide-y divide-border-faint px-4">
        <div className="flex items-center justify-between gap-4 py-2.5">
          <dt className="text-caption text-muted-foreground">{t("stripe.webhook")}</dt>
          <dd className="truncate font-mono text-meta text-foreground-secondary">/api/webhooks/stripe</dd>
        </div>
        {["invoice.paid", "charge.refunded", "customer.subscription.updated"].map((event) => (
          <div key={event} className="flex items-center justify-between gap-4 py-2.5">
            <dd className="truncate font-mono text-meta text-foreground-secondary">{event}</dd>
            <Check className="size-3.5 shrink-0 text-success-foreground" />
          </div>
        ))}
      </dl>
    </Frame>
  )
}

/** Step 2 — the program's rule, as the app shows it. */
export async function RulesVisual() {
  const t = await getTranslations("marketing.preview.rules")
  const rules = [
    { label: t("commission"), value: "30%" },
    { label: t("duration"), value: t("months", { count: 12 }) },
    { label: t("model"), value: t("lastClick") },
    { label: t("window"), value: t("days", { count: 60 }) },
    { label: t("hold"), value: t("days", { count: 30 }) },
  ]
  return (
    <Frame>
      <div className="border-b border-border px-4 py-3">
        <p className="text-caption font-medium text-foreground">Partner Program</p>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 px-4 sm:grid-cols-3">
        {rules.map((rule, index) => (
          <div key={rule.label} className={cn("space-y-0.5 py-3", index < 3 && "border-b border-border-faint")}>
            <dt className="text-meta text-muted-foreground">{rule.label}</dt>
            <dd className="text-ui text-foreground">{rule.value}</dd>
          </div>
        ))}
      </dl>
    </Frame>
  )
}

/** Step 3 — affiliates with their links. */
export async function InviteVisual() {
  const t = await getTranslations("marketing.preview")
  const rows = [
    { name: "Marina Costa", link: "acme.com/?ref=marina", status: "active" },
    { name: "Agency Labs", link: "acme.com/?ref=agencylabs", status: "active" },
    { name: "Pedro Lima", link: "acme.com/?ref=pedro", status: "invited" },
  ] as const
  return (
    <Frame>
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <p className="text-caption font-medium text-foreground">{t("invitePanel.title")}</p>
        <span className={buttonVariants({ variant: "secondary", size: "xs" })}>{t("invite")}</span>
      </div>
      <ul className="px-4">
        {rows.map((row) => (
          <li key={row.name} className="flex items-center gap-3 border-b border-border-faint py-2.5 last:border-0">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-fill-strong text-micro text-foreground-secondary">
              {initials(row.name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-caption text-foreground">{row.name}</p>
              <p className="truncate font-mono text-meta text-muted-foreground">{row.link}</p>
            </div>
            <StatusBadge status={row.status} />
          </li>
        ))}
      </ul>
    </Frame>
  )
}

/** Step 4 — revenue picking up. */
export async function RevenueVisual() {
  const t = await getTranslations("marketing.preview")
  const { locale, format } = await money()
  const percent = new Intl.NumberFormat(locale, { style: "percent", signDisplay: "always", maximumFractionDigits: 1 }).format(0.234)
  return (
    <Frame>
      <div className="px-4 pt-4">
        <p className="text-caption text-muted-foreground">{t("metrics.revenue")}</p>
        <p className="mt-1 flex items-baseline gap-2">
          <span className="text-subheading tabular-nums text-foreground">{format(1843020)}</span>
          <span className="text-meta tabular-nums text-success-foreground">{percent}</span>
        </p>
      </div>
      <div className="h-32 px-1 pb-2 pt-3">
        <AreaChart />
      </div>
    </Frame>
  )
}

/** Feature — attribution decided by the program's rule. */
export async function AttributionVisual() {
  const t = await getTranslations("marketing.preview.timeline")
  const { f } = await money()
  const date = (day: number) => f.date(new Date(Date.UTC(2026, 8, day)))
  const events = [
    { day: 2, icon: MousePointerClick, text: t("click", { link: "?ref=marina" }), muted: true },
    { day: 11, icon: MousePointerClick, text: t("click", { link: "?ref=joao" }), muted: false },
    { day: 14, icon: CreditCard, text: t("subscribed"), muted: false },
  ]
  return (
    <Frame>
      <ol className="px-4 pt-2">
        {events.map((event) => (
          <li key={event.day} className="relative flex gap-3 py-2.5">
            <span className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface-1 text-muted-foreground">
              <event.icon className="size-3.5" />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={cn("text-caption", event.muted ? "text-muted-foreground line-through decoration-border-strong" : "text-foreground")}>
                {event.text}
              </p>
              <p className="text-meta tabular-nums text-faint-foreground">{date(event.day)}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mx-4 mb-4 mt-1 flex items-center gap-3 rounded-control border border-border bg-surface-2 px-3 py-2.5">
        <Check className="size-4 shrink-0 text-success-foreground" />
        <div className="min-w-0">
          <p className="text-caption font-medium text-foreground">{t("result", { name: "João Pereira" })}</p>
          <p className="text-meta text-muted-foreground">{t("rule")}</p>
        </div>
      </div>
    </Frame>
  )
}

/** Feature — renewals earn, a refund reverses. */
export async function LedgerVisual() {
  const t = await getTranslations("marketing.preview.ledger")
  const { format } = await money()
  const rows = [
    { label: t("month", { count: 1 }), amount: format(14910), status: "paid" },
    { label: t("month", { count: 2 }), amount: format(14910), status: "available" },
    { label: t("month", { count: 3 }), amount: format(14910), status: "reversed" },
    { label: t("refund"), amount: `−${format(14910)}`, status: "refund" },
  ] as const
  return (
    <Frame>
      <ul className="px-4">
        {rows.map((row) => (
          <li key={row.label} className="flex h-12 items-center gap-3 border-b border-border-faint last:border-0">
            <span className="min-w-0 flex-1 truncate text-caption text-foreground-secondary">{row.label}</span>
            <span
              className={cn(
                "text-caption tabular-nums",
                row.status === "refund" ? "text-danger-foreground" : "text-foreground",
              )}
            >
              {row.amount}
            </span>
            <span className="flex w-24 shrink-0 justify-end">
              <StatusBadge status={row.status} />
            </span>
          </li>
        ))}
      </ul>
    </Frame>
  )
}

/** Feature — a payout batch ready to be marked paid. */
export async function PayoutVisual() {
  const t = await getTranslations("marketing.preview.payout")
  const { format } = await money()
  const rows = [
    { name: "Marina Costa", count: 6, amount: 89460 },
    { name: "Agency Labs", count: 4, amount: 59640 },
    { name: "Studio Norte", count: 2, amount: 35820 },
  ]
  const total = rows.reduce((sum, row) => sum + row.amount, 0)
  return (
    <Frame>
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <p className="text-caption font-medium text-foreground">{t("title")}</p>
        <span className={buttonVariants({ variant: "secondary", size: "xs" })}>{t("markPaid")}</span>
      </div>
      <ul className="px-4">
        {rows.map((row) => (
          <li key={row.name} className="flex h-12 items-center gap-3 border-b border-border-faint">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-fill-strong text-micro text-foreground-secondary">
              {initials(row.name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-caption text-foreground">{row.name}</p>
              <p className="text-meta text-muted-foreground">{t("items", { count: row.count })}</p>
            </div>
            <span className="text-caption tabular-nums text-foreground">{format(row.amount)}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-caption text-muted-foreground">{t("total")}</span>
        <span className="text-ui font-medium tabular-nums text-foreground">{format(total)}</span>
      </div>
    </Frame>
  )
}

/** Two sides — the founder's view of the program. */
export async function FounderVisual() {
  const t = await getTranslations("marketing.preview")
  const table = await getTranslations("common.table")
  const { format } = await money()
  const rows = [
    { name: "Marina Costa", revenue: 894600, commission: 268380, status: "active" },
    { name: "Agency Labs", revenue: 656700, commission: 197010, status: "active" },
    { name: "Studio Norte", revenue: 417900, commission: 125370, status: "paused" },
  ] as const
  return (
    <Frame>
      <div className="grid grid-cols-2 gap-x-6 border-b border-border px-4">
        <div className="space-y-0.5 py-3">
          <p className="text-meta text-muted-foreground">{t("metrics.revenue")}</p>
          <p className="text-title tabular-nums text-foreground">{format(1843020)}</p>
        </div>
        <div className="space-y-0.5 py-3">
          <p className="text-meta text-muted-foreground">{t("metrics.commissions")}</p>
          <p className="text-title tabular-nums text-foreground">{format(552906)}</p>
        </div>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4">
        <span className="py-2 text-meta text-muted-foreground">{table("affiliate")}</span>
        <span className="py-2 text-right text-meta text-muted-foreground">{table("commission")}</span>
        <span className="py-2 text-meta text-muted-foreground">{table("status")}</span>
        {rows.map((row) => (
          <div key={row.name} className="contents">
            <span className="truncate border-t border-border-faint py-2.5 text-caption text-foreground">{row.name}</span>
            <span className="border-t border-border-faint py-2.5 text-right text-caption tabular-nums text-foreground-secondary">
              {format(row.commission)}
            </span>
            <span className="border-t border-border-faint py-2">
              <StatusBadge status={row.status} />
            </span>
          </div>
        ))}
      </div>
    </Frame>
  )
}

/** Two sides — the affiliate's portal, at phone width. */
export async function AffiliateVisual() {
  const t = await getTranslations("marketing.preview.portal")
  const { f, format } = await money()
  return (
    <Frame className="mx-auto w-full max-w-xs">
      <div className="px-4 pt-4">
        <p className="text-caption text-muted-foreground">{t("greeting")}</p>
        <p className="mt-3 text-meta text-muted-foreground">{t("unpaid")}</p>
        <p className="text-subheading tabular-nums text-foreground">{format(89460)}</p>
        <p className="text-meta tabular-nums text-muted-foreground">
          {t("paid")} · {format(178920)}
        </p>
      </div>
      <div className="mt-4 grid grid-cols-2 border-y border-border">
        <div className="space-y-0.5 px-4 py-3">
          <p className="text-meta text-muted-foreground">{t("clicks")}</p>
          <p className="text-ui tabular-nums text-foreground">{f.number(1284)}</p>
        </div>
        <div className="space-y-0.5 border-l border-border px-4 py-3">
          <p className="text-meta text-muted-foreground">{t("customers")}</p>
          <p className="text-ui tabular-nums text-foreground">{f.number(18)}</p>
        </div>
      </div>
      <div className="p-4">
        <p className="mb-1.5 text-meta text-muted-foreground">{t("yourLink")}</p>
        <div className="flex items-center gap-2 rounded-control border border-border bg-fill-subtle py-1 pl-2.5 pr-1">
          <span className="min-w-0 flex-1 truncate font-mono text-meta text-foreground-secondary">acme.com/?ref=marina</span>
          <span className={cn(buttonVariants({ variant: "secondary", size: "xs" }), "gap-1")}>
            <Copy />
          </span>
        </div>
      </div>
    </Frame>
  )
}

