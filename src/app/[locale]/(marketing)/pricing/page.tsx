import { ArrowRight, Check } from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server"

import { Link } from "@/i18n/navigation"
import { getFormatters } from "@/i18n/format"
import { DEFAULT_CURRENCY, type Locale } from "@/i18n/routing"
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
    <div className="mx-auto w-full max-w-page px-4 py-16 sm:px-6 sm:py-24">
      <div className="max-w-2xl">
        <h1 className="text-heading-sm font-medium sm:text-heading">{t("title")}</h1>
        <p className="mt-4 text-body-sm leading-relaxed text-muted-foreground">
          {t("subtitle")}
        </p>
      </div>

      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <div
            key={plan.key}
            className={cn(
              "flex flex-col rounded-panel border bg-surface-1 p-6",
              plan.featured ? "border-border-strong" : "border-border",
            )}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-body-sm font-medium">{t(`plans.${plan.key}.name`)}</h2>
              {plan.featured ? (
                <span className="rounded-badge bg-primary/15 px-2 py-0.5 text-label font-medium text-foreground">
                  {t("mostPopular")}
                </span>
              ) : null}
            </div>

            <p className="mt-4 flex items-baseline gap-1.5">
              <span className="text-heading-sm font-medium tabular-nums tracking-tight">
                {f.money(prices[plan.key] ?? 0, currency)}
              </span>
              <span className="text-caption text-muted-foreground">
                {t(`plans.${plan.key}.cadence`)}
              </span>
            </p>

            <p className="mt-3 text-caption leading-relaxed text-muted-foreground">
              {t(`plans.${plan.key}.description`)}
            </p>

            <ul className="mt-6 flex-1 space-y-2.5">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-caption">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                  <span className="text-foreground-secondary">
                    {t(`plans.${plan.key}.features.${feature}`)}
                  </span>
                </li>
              ))}
            </ul>

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
          </div>
        ))}
      </div>
    </div>
  )
}
