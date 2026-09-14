import { ArrowRight, Check } from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server"

import { Link } from "@/i18n/navigation"
import { getFormatters } from "@/i18n/format"
import { DEFAULT_CURRENCY, type Locale } from "@/i18n/routing"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/pricing">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "pricing" })
  return { title: t("metaTitle") }
}

/**
 * Prices are per-locale amounts in minor units, not one number converted at
 * render time: a Brazilian plan is priced in reais as a commercial decision,
 * not as today's exchange rate applied to a dollar figure.
 *
 * The featured plan carries the page's one amber action; the header's
 * "Start free" goes to the same place, so the two never ask different things.
 */
const PRICE_MINOR: Record<Locale, Record<string, number>> = {
  "pt-br": { starter: 0, growth: 19700, scale: 59700 },
  en: { starter: 0, growth: 4900, scale: 14900 },
}

const PLANS = [
  { key: "starter", featured: false, features: ["programs", "affiliates", "tracking", "ledger", "payouts"] },
  { key: "growth", featured: true, features: ["programs", "affiliates", "rates", "batches", "team"] },
  { key: "scale", featured: false, features: ["everything", "workspaces", "support", "retention", "onboarding"] },
] as const

export default async function PricingPage({ params }: PageProps<"/[locale]/pricing">) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations("pricing")
  const f = await getFormatters()
  const currency = DEFAULT_CURRENCY[(await getLocale()) as Locale]
  const prices = PRICE_MINOR[locale as Locale]

  return (
    <div className="mx-auto w-full max-w-page px-4 py-24 sm:px-6 sm:py-32">
      <div className="max-w-3xl">
        <h1 className="text-balance text-heading-sm text-foreground sm:text-heading lg:text-heading-lg">
          {t("title")}
        </h1>
        <p className="mt-6 max-w-2xl text-pretty text-body text-muted-foreground">
          {t("subtitle")}
        </p>
      </div>

      <div className="mt-16 grid gap-3 sm:mt-20 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <div
            key={plan.key}
            className={cn(
              "flex flex-col rounded-panel border bg-surface-1 p-6",
              plan.featured ? "border-border-strong" : "border-border",
            )}
          >
            <div className="flex h-5 items-center justify-between gap-3">
              <h2 className="text-ui font-medium text-foreground">{t(`plans.${plan.key}.name`)}</h2>
              {plan.featured ? (
                <Badge tone="primary" dot={false}>
                  {t("mostPopular")}
                </Badge>
              ) : null}
            </div>

            <p className="mt-6 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="whitespace-nowrap text-heading-sm tabular-nums text-foreground">
                {f.money(prices[plan.key] ?? 0, currency)}
              </span>
              <span className="text-caption text-muted-foreground">
                {t(`plans.${plan.key}.cadence`)}
              </span>
            </p>

            <p className="mt-3 text-pretty text-caption text-muted-foreground">
              {t(`plans.${plan.key}.description`)}
            </p>

            <Button
              asChild
              variant={plan.featured ? "primary" : "secondary"}
              size="lg"
              className="mt-6 w-full"
            >
              <Link href="/signup">
                {t("cta")}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>

            <ul className="mt-6 flex-1 space-y-2.5 border-t border-border-faint pt-6">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-caption">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-faint-foreground" aria-hidden="true" />
                  <span className="text-foreground-secondary">
                    {t(`plans.${plan.key}.features.${feature}`)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
