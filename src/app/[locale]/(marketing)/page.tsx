import {
  ArrowRight,
  ArrowUp,
  ChartNoAxesColumn,
  Check,
  ChevronsUpDown,
  Coins,
  CreditCard,
  Layers,
  type LucideIcon,
  Receipt,
  Search,
  Settings2,
  Users,
} from "lucide-react"
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server"

import { Link } from "@/i18n/navigation"
import { getFormatters } from "@/i18n/format"
import { DEFAULT_CURRENCY, type Locale } from "@/i18n/routing"
import { Button, buttonVariants } from "@/components/ui/button"
import { StatusBadge } from "@/components/ui/badge"
import { Kbd } from "@/components/ui/kbd"
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table"
import { cn, initials } from "@/lib/utils"

/**
 * The product is the hero — DESIGN.md §1. No illustrations, no gradient blobs:
 * a mock of the real product shell built from the same tokens as the app, so
 * the page cannot drift from what a founder sees after signing up.
 */
export default async function MarketingHomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations("marketing.home")

  const promises = ["noProcessing", "stripeStaysYours", "liveInAnHour"] as const
  const pillars = ["attribution", "ledger", "rails"] as const
  const steps = ["connect", "commission", "tracking", "invite"] as const

  return (
    <>
      <section className="mx-auto w-full max-w-page px-4 pt-20 sm:px-6 sm:pt-28 lg:pt-32">
        <div className="max-w-4xl">
          <p className="mb-6 flex items-center gap-2 text-caption text-muted-foreground">
            <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            {t("eyebrow")}
          </p>

          <h1 className="text-balance text-heading-sm text-foreground sm:text-heading lg:text-heading-lg">
            {t("headline")}
          </h1>

          <p className="mt-6 max-w-2xl text-pretty text-body text-muted-foreground">
            {t("subhead")}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild variant="primary" size="lg">
              <Link href="/signup">
                {t("ctaPrimary")}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="lg">
              <Link href="/docs">{t("ctaSecondary")}</Link>
            </Button>
          </div>

          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-caption text-muted-foreground">
            {promises.map((key) => (
              <li key={key} className="flex items-center gap-1.5">
                <Check className="size-3.5 text-faint-foreground" aria-hidden="true" />
                {t(`promises.${key}`)}
              </li>
            ))}
          </ul>
        </div>

        <ProductPreview />
      </section>

      <section className="mx-auto w-full max-w-page px-4 py-24 sm:px-6 sm:py-32">
        <ul className="grid gap-10 md:grid-cols-3 md:gap-8">
          {pillars.map((key) => (
            <li key={key} className="border-t border-border pt-6">
              <h2 className="text-body font-medium text-foreground">
                {t(`pillars.${key}.title`)}
              </h2>
              <p className="mt-2 text-pretty text-body-sm text-muted-foreground">
                {t(`pillars.${key}.body`)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto grid w-full max-w-page gap-12 px-4 py-24 sm:px-6 sm:py-32 lg:grid-cols-12 lg:gap-16">
          <div className="lg:sticky lg:top-24 lg:col-span-5 lg:self-start">
            <h2 className="text-balance text-heading-sm text-foreground sm:text-heading">
              {t("steps.title")}
            </h2>
            <p className="mt-5 max-w-md text-pretty text-body text-muted-foreground">
              {t("steps.subtitle")}
            </p>
          </div>

          <ol className="border-b border-border lg:col-span-7">
            {steps.map((key, index) => (
              <li
                key={key}
                className="flex gap-4 border-t border-border py-6 sm:py-8"
              >
                <span className="w-10 shrink-0 pt-1 font-mono text-meta text-faint-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <h3 className="text-title text-foreground">{t(`steps.${key}.title`)}</h3>
                  <p className="mt-1.5 text-pretty text-body-sm text-muted-foreground">
                    {t(`steps.${key}.body`)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto flex w-full max-w-page flex-col items-start gap-8 px-4 py-24 sm:px-6 sm:py-32 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-balance text-heading-sm text-foreground sm:text-heading">
              {t("closing.title")}
            </h2>
            <p className="mt-5 text-pretty text-body text-muted-foreground">{t("closing.body")}</p>
          </div>
          <Button asChild variant="primary" size="lg">
            <Link href="/signup">
              {t("ctaPrimary")}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </section>
    </>
  )
}

/** Illustrative ledger rows. Names and codes are data, not interface copy. */
const ROWS = [
  { name: "Marina Costa", code: "MARINA30", base: 49700, commission: 14910, status: "approved", day: 12 },
  { name: "Agency Labs", code: "AGENCYLABS", base: 149700, commission: 44910, status: "pending", day: 12 },
  { name: "João Pereira", code: "JOAO20", base: 19700, commission: 3940, status: "hold", day: 11 },
  { name: "Studio Norte", code: "NORTE", base: 59700, commission: 17910, status: "paid", day: 9 },
  { name: "Lucas Almeida", code: "LUCAS30", base: 19700, commission: 5910, status: "reversed", day: 8 },
] as const

/**
 * A static, token-built mock of the founder dashboard: sidebar on the canvas
 * plane, the page inside one inset content panel — the same frame as
 * `AppShell`. Decorative, so it is hidden from assistive technology and holds
 * no focusable element (the "button" is a styled span).
 *
 * Figures are formatted for the reader's locale and denominated in the
 * currency they are most likely to be paid in, so a Brazilian visitor is not
 * asked to picture their business in dollars.
 */
async function ProductPreview() {
  const t = await getTranslations("marketing.preview")
  const nav = await getTranslations("nav")
  const dash = await getTranslations("dashboard")
  const table = await getTranslations("common.table")
  const f = await getFormatters()
  const locale = (await getLocale()) as Locale
  const currency = DEFAULT_CURRENCY[locale]

  // Formatted, not typed out: "+23.4%" and "+23,4%" are the same number and
  // the mock must not contradict the locale it is rendered in.
  const percent = (value: number) =>
    new Intl.NumberFormat(locale, {
      style: "percent",
      signDisplay: "always",
      maximumFractionDigits: 1,
    }).format(value)
  const signed = (value: number) =>
    new Intl.NumberFormat(locale, { signDisplay: "always" }).format(value)

  const metrics = [
    { key: "revenue", value: f.money(1843020, currency), delta: percent(0.234) },
    { key: "commissions", value: f.money(552906, currency), delta: percent(0.191) },
    { key: "affiliates", value: f.number(34), delta: signed(6) },
  ] as const

  const sections: { key: string; label?: string; items: { label: string; icon: LucideIcon; active?: boolean }[] }[] = [
    { key: "home", items: [{ label: nav("overview"), icon: ChartNoAxesColumn }] },
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
        { label: nav("commissions"), icon: Coins, active: true },
        { label: nav("payouts"), icon: CreditCard },
      ],
    },
  ]

  const workspace = "Acme"

  return (
    <div
      aria-hidden="true"
      className="mt-16 flex select-none overflow-hidden rounded-panel border border-border bg-background p-1.5 sm:mt-20 sm:p-2"
    >
      {/* Sidebar — the canvas plane. */}
      <div className="hidden w-52 shrink-0 flex-col pr-2 md:flex lg:w-56">
        <div className="flex h-12 items-center gap-2 px-1.5">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-badge bg-inverse text-micro text-inverse-foreground">
            {initials(workspace)}
          </span>
          <span className="min-w-0 flex-1 truncate text-caption font-semibold text-foreground">
            {workspace}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </div>

        <div className="pb-2">
          <div className="flex h-8 items-center gap-2.5 rounded-control border border-border bg-fill-subtle px-2 text-caption text-faint-foreground">
            <Search className="size-3.5 shrink-0" />
            <span className="flex-1">{nav("search")}</span>
            <Kbd>⌘K</Kbd>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-5 pt-2">
          {sections.map((section) => (
            <div key={section.key} className="flex flex-col gap-px">
              {section.label ? (
                <p className="px-2 pb-1 text-meta text-faint-foreground">{section.label}</p>
              ) : null}
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

        <div className="mt-6 border-t border-border-faint pt-2">
          <span className="flex h-8 items-center gap-2.5 rounded-control px-2 text-caption font-medium text-muted-foreground">
            <Settings2 className="size-4 shrink-0" />
            <span className="truncate">{nav("settings")}</span>
          </span>
        </div>
      </div>

      {/* Content panel — inset, hairline-bordered. */}
      <div className="min-w-0 flex-1 overflow-hidden rounded-panel border border-border bg-surface-1">
        <div className="flex h-12 items-center gap-3 border-b border-border px-4 sm:px-6">
          <span className="truncate text-caption font-medium text-foreground">
            {dash("commissions.title")}
          </span>
          <span className="text-caption tabular-nums text-muted-foreground">{f.number(128)}</span>
          <span className={cn(buttonVariants({ variant: "primary", size: "sm" }), "ml-auto")}>
            {dash("overview.reviewPayouts")}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-6 border-b border-border px-4 sm:grid-cols-3 sm:px-6">
          {metrics.map((metric, index) => (
            <div key={metric.key} className={cn("min-w-0 space-y-1 py-4", index === 2 && "hidden sm:block")}>
              <p className="truncate text-caption text-muted-foreground">{t(`metrics.${metric.key}`)}</p>
              <p className="whitespace-nowrap text-title tabular-nums text-foreground">{metric.value}</p>
              <p className="flex items-center gap-1.5 text-meta">
                <span className="inline-flex items-center gap-0.5 font-medium tabular-nums text-success-foreground">
                  <ArrowUp className="size-3" />
                  {metric.delta}
                </span>
                <span className="hidden truncate text-muted-foreground lg:inline">
                  {dash("overview.metrics.comparison")}
                </span>
              </p>
            </div>
          ))}
        </div>

        <div className="px-3 sm:px-5">
          <Table>
            <THead>
              <tr>
                <TH>{t("columns.affiliate")}</TH>
                <TH className="hidden sm:table-cell">{table("code")}</TH>
                <TH numeric className="hidden md:table-cell">
                  {t("columns.revenue")}
                </TH>
                <TH numeric>{t("columns.commission")}</TH>
                <TH>{table("status")}</TH>
                <TH numeric className="hidden lg:table-cell">
                  {table("date")}
                </TH>
              </tr>
            </THead>
            <TBody>
              {ROWS.map((row) => (
                <TR key={row.code}>
                  <TD>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="hidden size-5 shrink-0 items-center justify-center rounded-full bg-fill-strong sm:flex text-micro text-foreground-secondary">
                        {initials(row.name)}
                      </span>
                      <span className="truncate text-foreground">{row.name}</span>
                    </span>
                  </TD>
                  <TD mono className="hidden text-muted-foreground sm:table-cell">
                    {row.code}
                  </TD>
                  <TD numeric className="hidden md:table-cell">
                    {f.money(row.base, currency)}
                  </TD>
                  <TD numeric className="text-foreground">
                    {f.money(row.commission, currency)}
                  </TD>
                  <TD>
                    <StatusBadge status={row.status} />
                  </TD>
                  <TD numeric className="hidden text-muted-foreground lg:table-cell">
                    {f.date(new Date(Date.UTC(2026, 8, row.day)))}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
