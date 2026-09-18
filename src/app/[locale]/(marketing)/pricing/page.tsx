import { ArrowRight } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"
import type { Locale } from "@/i18n/routing"
import { JsonLd } from "@/components/seo/json-ld"
import { PLAN_OFFERS } from "@/lib/plans"
import { CORE_FEATURES, formatPlanPrice, PRICING_CARDS } from "@/lib/plans-display"
import { pageMetadata, pageUrl } from "@/lib/seo/metadata"
import { breadcrumbJsonLd } from "@/lib/seo/structured-data"
import { cn } from "@/lib/utils"
import { PAST_DUE_GRACE_DAYS } from "@/server/domain/entitlements"

import { PlanLines } from "../_components/plan-lines"

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/pricing">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "pricing" })
  // Prices in the description come from PLAN_OFFERS, never from the catalogue.
  const description = t("metaDescription", {
    launchPrice: formatPlanPrice(locale, PLAN_OFFERS.launch.priceMonthlyMinor ?? 0, PLAN_OFFERS.launch.currency),
    growthPrice: formatPlanPrice(locale, PLAN_OFFERS.growth.priceMonthlyMinor ?? 0, PLAN_OFFERS.growth.currency),
  })
  return pageMetadata({ href: "/pricing", locale: locale as Locale, title: t("metaTitle"), description })
}

/** How Refvia charges, in the order a founder meets it (docs/PLANS.md §5–6). */
const BILLING_QUESTIONS = ["sandbox", "activate", "change", "cancel", "pastDue"] as const

export default async function PricingPage({ params }: PageProps<"/[locale]/pricing">) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations()
  const crumbs = [
    { name: t("seo.breadcrumb.home"), url: pageUrl("/", locale as Locale) },
    { name: t("marketing.chrome.pricing"), url: pageUrl("/pricing", locale as Locale) },
  ]

  return (
    <div className="mx-auto w-full max-w-page px-4 py-24 sm:px-6 sm:py-32">
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <div className="max-w-3xl">
        <h1 className="text-balance text-heading-sm text-foreground sm:text-heading lg:text-heading-lg">
          {t("pricing.title")}
        </h1>
        <p className="mt-6 max-w-2xl text-pretty text-body text-muted-foreground">{t("pricing.subtitle")}</p>
      </div>

      {/* Three comparable cards: each lists only what differs between plans
          (mode, limits, added features), so they read side by side at the
          same height. What every plan shares is said once, below. */}
      <div className="mt-16 grid gap-3 sm:mt-20 lg:grid-cols-3">
        {PRICING_CARDS.map((plan) => {
          const free = plan.priceMonthlyMinor === 0
          return (
            <div
              key={plan.code}
              className={cn(
                "flex flex-col rounded-panel border bg-surface-1 p-6",
                plan.recommended ? "border-border-strong" : "border-border",
              )}
            >
              <div className="flex h-5 items-center justify-between gap-3">
                <h2 className="text-ui font-medium text-foreground">{t(plan.nameKey)}</h2>
                {plan.recommended ? (
                  <Badge tone="primary" dot={false}>
                    {t("pricing.recommended")}
                  </Badge>
                ) : free ? (
                  <Badge dot={false}>{t("pricing.testOnlyBadge")}</Badge>
                ) : null}
              </div>

              <p className="mt-6 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="whitespace-nowrap text-heading-sm tabular-nums text-foreground">
                  {free ? t("pricing.free") : formatPlanPrice(locale, plan.priceMonthlyMinor, plan.currency)}
                </span>
                <span className="text-caption text-muted-foreground">
                  {free ? t("pricing.noExpiry") : t("pricing.perMonth")}
                </span>
              </p>

              <p className="mt-3 min-h-10 text-pretty text-caption text-muted-foreground">{t(plan.descriptionKey)}</p>

              {/* Every CTA leads to sign-up: a workspace starts on Sandbox and a
                  plan is activated in Settings, through Stripe Checkout. */}
              <Button
                asChild
                variant={plan.recommended ? "primary" : "secondary"}
                size="lg"
                className="mt-6 w-full"
              >
                <Link href={plan.cta.href}>
                  {t(plan.cta.key)}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>

              <PlanLines lines={plan.lines} className="mt-6 flex-1 border-t border-border-faint pt-6" />
            </div>
          )
        })}
      </div>

      <p className="mt-6 max-w-3xl text-pretty text-caption text-muted-foreground">
        {t("pricing.startNote")} {t("pricing.currencyNote")}
      </p>

      <section aria-labelledby="pricing-core" className="mt-16 rounded-panel border border-border bg-surface-1 p-6 sm:p-8">
        <div className="max-w-2xl">
          <h2 id="pricing-core" className="text-title text-foreground">
            {t("pricing.core.title")}
          </h2>
          <p className="mt-2 text-pretty text-caption text-muted-foreground">{t("pricing.core.subtitle")}</p>
        </div>
        <PlanLines
          lines={CORE_FEATURES.map((item) => ({ kind: "core" as const, item }))}
          className="mt-6 grid gap-x-8 gap-y-3 space-y-0 sm:grid-cols-2 lg:grid-cols-3"
        />
      </section>

      <section aria-labelledby="pricing-billing" className="mt-20 border-t border-border pt-12">
        <h2 id="pricing-billing" className="text-subheading text-foreground">
          {t("pricing.billing.title")}
        </h2>
        <dl className="mt-8 grid gap-x-12 gap-y-8 md:grid-cols-2">
          {BILLING_QUESTIONS.map((question) => (
            <div key={question}>
              <dt className="text-caption font-medium text-foreground">{t(`pricing.billing.${question}.question`)}</dt>
              <dd className="mt-1 text-pretty text-caption text-muted-foreground">
                {t(`pricing.billing.${question}.answer`, { days: PAST_DUE_GRACE_DAYS })}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}
