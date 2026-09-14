import { ArrowRight, Check } from "lucide-react"
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server"

import { Link } from "@/i18n/navigation"
import { getFormatters } from "@/i18n/format"
import { DEFAULT_CURRENCY, type Locale } from "@/i18n/routing"
import { Button } from "@/components/ui/button"

/**
 * The product is the hero — DESIGN.md §1. No illustrations, no gradient blobs:
 * a real dashboard mock built from the same tokens as the app itself.
 */
export default async function MarketingHomePage({
  params,
}: PageProps<"/[locale]">) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations("marketing.home")

  const promises = ["noProcessing", "stripeStaysYours", "liveInAnHour"] as const
  const pillars = ["attribution", "ledger", "rails"] as const
  const steps = ["connect", "commission", "tracking", "invite"] as const

  return (
    <>
      <section className="mx-auto w-full max-w-page px-4 pb-16 pt-16 sm:px-6 sm:pb-24 sm:pt-24">
        <div className="max-w-3xl">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-surface-1 px-3 py-1 text-meta text-muted-foreground">
            <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
            {t("eyebrow")}
          </p>

          <h1 className="text-balance text-heading-sm font-medium sm:text-heading-lg">
            {t("headline")}
          </h1>

          <p className="mt-5 max-w-2xl text-pretty text-body leading-relaxed text-muted-foreground sm:text-body-md">
            {t("subhead")}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild variant="primary" size="lg">
              <Link href="/signup">
                {t("ctaPrimary")}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href="/docs">{t("ctaSecondary")}</Link>
            </Button>
          </div>

          <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-caption text-muted-foreground">
            {promises.map((key) => (
              <li key={key} className="flex items-center gap-1.5">
                <Check className="size-3.5 text-primary" aria-hidden="true" />
                {t(`promises.${key}`)}
              </li>
            ))}
          </ul>
        </div>

        <DashboardPreview />
      </section>

      <section className="border-y border-border bg-surface-1">
        <div className="mx-auto grid w-full max-w-page gap-px bg-border px-0 sm:grid-cols-3">
          {pillars.map((key) => (
            <div key={key} className="bg-surface-1 px-6 py-8">
              <h2 className="mb-2 text-body-sm font-medium tracking-tight">
                {t(`pillars.${key}.title`)}
              </h2>
              <p className="text-caption leading-relaxed text-muted-foreground">
                {t(`pillars.${key}.body`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-page px-4 py-16 sm:px-6 sm:py-24">
        <h2 className="mb-2 text-heading-sm font-medium">{t("steps.title")}</h2>
        <p className="mb-10 max-w-2xl text-body-sm leading-relaxed text-muted-foreground">
          {t("steps.subtitle")}
        </p>

        <ol className="grid gap-px overflow-hidden rounded-panel border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((key, index) => (
            <li key={key} className="bg-surface-1 px-6 py-7">
              <span className="font-mono text-meta text-primary">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="mb-1.5 mt-3 text-body-sm font-medium tracking-tight">
                {t(`steps.${key}.title`)}
              </h3>
              <p className="text-caption leading-relaxed text-muted-foreground">
                {t(`steps.${key}.body`)}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto flex w-full max-w-page flex-wrap items-center justify-between gap-6 px-4 py-16 sm:px-6">
          <div className="max-w-xl">
            <h2 className="text-heading-sm font-medium">{t("closing.title")}</h2>
            <p className="mt-2 text-ui leading-relaxed text-muted-foreground">
              {t("closing.body")}
            </p>
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

/**
 * A static, token-built mock of the real overview screen. The figures are
 * formatted for the reader's locale and denominated in the currency they are
 * most likely to be paid in, so a Brazilian visitor is not asked to picture
 * their business in dollars.
 */
async function DashboardPreview() {
  const t = await getTranslations("marketing.preview")
  const f = await getFormatters()
  const locale = (await getLocale()) as Locale
  const currency = DEFAULT_CURRENCY[locale]

  const bars = [32, 41, 38, 55, 48, 62, 58, 71, 66, 84, 78, 96]

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

  const rows = [
    ["Wendel", 612000, 183600],
    ["Agency Labs", 498000, 149400],
    ["João", 341020, 102306],
  ] as const

  return (
    <div className="mt-14 overflow-hidden rounded-panel border border-border bg-surface-1">
      <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
        <span className="size-2 rounded-full bg-border-strong" aria-hidden="true" />
        <span className="size-2 rounded-full bg-border-strong" aria-hidden="true" />
        <span className="size-2 rounded-full bg-border-strong" aria-hidden="true" />
        <span className="ml-2 font-mono text-label text-muted-foreground">
          acme.indica.app
        </span>
      </div>

      <div className="grid gap-px bg-border sm:grid-cols-3">
        {metrics.map((metric) => (
          <div key={metric.key} className="bg-surface-1 px-5 py-4">
            <p className="text-label uppercase tracking-[0.02em] text-muted-foreground">
              {t(`metrics.${metric.key}`)}
            </p>
            <p className="mt-1.5 text-subheading font-medium tabular-nums tracking-tight">
              {metric.value}
            </p>
            <p className="mt-1 text-meta text-success-foreground">{metric.delta}</p>
          </div>
        ))}
      </div>

      <div className="border-t border-border px-5 py-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-caption font-medium">{t("chartTitle")}</p>
          <div className="flex gap-3 text-label text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-chart-1" aria-hidden="true" />
              {t("legendRevenue")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-chart-2" aria-hidden="true" />
              {t("legendCommission")}
            </span>
          </div>
        </div>
        <div className="flex h-28 items-end gap-1.5" aria-hidden="true">
          {bars.map((height, index) => (
            <span
              key={index}
              className="flex-1 rounded-t-hairline bg-chart-1/70"
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
      </div>

      <div className="border-t border-border">
        <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-4 bg-surface-2 px-5 py-2 text-label uppercase tracking-[0.02em] text-muted-foreground">
          <span>{t("columns.affiliate")}</span>
          <span className="text-right">{t("columns.revenue")}</span>
          <span className="text-right">{t("columns.commission")}</span>
        </div>
        {rows.map(([name, revenue, commission]) => (
          <div
            key={name}
            className="grid grid-cols-[1.4fr_1fr_1fr] gap-4 border-t border-border px-5 py-3 text-caption tabular-nums"
          >
            <span className="text-foreground">{name}</span>
            <span className="text-right text-muted-foreground">
              {f.money(revenue, currency)}
            </span>
            <span className="text-right text-foreground">
              {f.money(commission, currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
