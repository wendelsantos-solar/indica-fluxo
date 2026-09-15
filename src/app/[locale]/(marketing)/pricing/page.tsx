import { ArrowRight } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PlanLineList } from "@/features/plans/plan-lines"
import { getFormatters } from "@/i18n/format"
import { getPathname, Link } from "@/i18n/navigation"
import { DEFAULT_CURRENCY, type Locale } from "@/i18n/routing"
import { localeAlternates } from "@/lib/site"
import { cn } from "@/lib/utils"

import { MARKETING_PLANS, marketingPlanLines, PRICE_MINOR } from "../_lib/plans"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/pricing">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "pricing" })
  const { canonical, languages } = localeAlternates("/pricing", locale, (target) =>
    getPathname({ href: "/pricing", locale: target }),
  )
  return { title: t("metaTitle"), alternates: { canonical, languages } }
}

/** What happens between signing up and being on Growth, in order. */
const NEXT_STEPS = ["signup", "request", "contact"] as const

export default async function PricingPage({ params }: PageProps<"/[locale]/pricing">) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations("pricing")
  const tf = await getTranslations("marketing.home.pricing")
  const f = await getFormatters()
  const currency = DEFAULT_CURRENCY[locale as Locale]
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

      <div className="mt-16 grid max-w-4xl gap-3 sm:mt-20 md:grid-cols-2">
        {MARKETING_PLANS.map((plan) => (
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
                  {t("onRequest")}
                </Badge>
              ) : null}
            </div>

            <p className="mt-6 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="whitespace-nowrap text-heading-sm tabular-nums text-foreground">
                {prices[plan.key] === 0 ? tf("free") : f.money(prices[plan.key], currency)}
              </span>
              <span className="text-caption text-muted-foreground">
                {t(`plans.${plan.key}.cadence`)}
              </span>
            </p>

            <p className="mt-3 text-pretty text-caption text-muted-foreground">
              {t(`plans.${plan.key}.description`)}
            </p>

            {/* Both lead to sign-up: every workspace starts on Starter, and
                Growth is requested from inside the product. The label says so. */}
            <Button
              asChild
              variant={plan.featured ? "primary" : "secondary"}
              size="lg"
              className="mt-6 w-full"
            >
              <Link href="/signup">
                {t(`plans.${plan.key}.cta`)}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>

            <PlanLineList
              lines={marketingPlanLines(plan.key)}
              className="mt-6 flex-1 border-t border-border-faint pt-6"
            />
          </div>
        ))}
      </div>

      <p className="mt-6 max-w-4xl text-pretty text-caption text-muted-foreground">{t("startsOnStarter")}</p>

      <section aria-labelledby="pricing-next" className="mt-20 max-w-4xl border-t border-border pt-12">
        <h2 id="pricing-next" className="text-subheading text-foreground">
          {t("next.title")}
        </h2>
        <ol className="mt-8 grid gap-6 md:grid-cols-3">
          {NEXT_STEPS.map((step, index) => (
            <li key={step}>
              <p className="text-meta tabular-nums text-faint-foreground">{f.number(index + 1)}</p>
              <p className="mt-2 text-caption font-medium text-foreground">{t(`next.${step}.title`)}</p>
              <p className="mt-1 text-pretty text-caption text-muted-foreground">{t(`next.${step}.body`)}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
