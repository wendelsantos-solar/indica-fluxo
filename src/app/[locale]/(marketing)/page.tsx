import {
  ArrowRight,
  Check,
  CircleDollarSign,
  Code2,
  CreditCard,
  FileClock,
  Lock,
  Minus,
  ShieldCheck,
} from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server"
import type * as React from "react"

import { getFormatters } from "@/i18n/format"
import { getPathname, Link } from "@/i18n/navigation"
import { DEFAULT_CURRENCY, type Locale } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { localeAlternates, siteUrl } from "@/lib/site"
import { cn } from "@/lib/utils"

import { PLANS, PRICE_MINOR } from "./_lib/plans"
import {
  AffiliateVisual,
  AttributionVisual,
  FounderVisual,
  HeroPreview,
  InviteVisual,
  LedgerVisual,
  PayoutVisual,
  RevenueVisual,
  RulesVisual,
  StripeVisual,
} from "./_components/visuals"

export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "meta" })
  const url = (target: Locale) => new URL(getPathname({ href: "/", locale: target }), siteUrl()).toString()
  const { languages } = localeAlternates("/", locale, (target) => getPathname({ href: "/", locale: target }))

  return {
    title: { absolute: t("title") },
    description: t("description"),
    alternates: {
      canonical: url(locale as Locale),
      languages,
    },
    openGraph: {
      type: "website",
      siteName: "IndicaFluxo",
      title: t("title"),
      description: t("description"),
      url: url(locale as Locale),
      locale: locale === "pt-br" ? "pt_BR" : "en_US",
    },
    twitter: { card: "summary_large_image", title: t("title"), description: t("description") },
  }
}

/** Section rhythm: one container, one vertical cadence, used by every block. */
function Section({
  id,
  className,
  children,
  bordered = true,
}: {
  id?: string
  className?: string
  children: React.ReactNode
  bordered?: boolean
}) {
  return (
    <section id={id} className={cn("scroll-mt-16", bordered && "border-t border-border")}>
      <div className={cn("mx-auto w-full max-w-page px-4 py-20 sm:px-6 sm:py-28", className)}>{children}</div>
    </section>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 text-caption text-muted-foreground">{children}</p>
}

function Heading({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={cn("text-balance text-heading-sm text-foreground sm:text-heading", className)}>{children}</h2>
  )
}

/**
 * The landing is a sales page, told in order: what it is → how a referral
 * becomes money → why you should not build it → how to start → what makes it
 * right → both sides of the program → what it connects to → why to trust it →
 * what it costs → start. The product is the only imagery (DESIGN.md §1).
 */
export default async function MarketingHomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations("marketing.home")

  return (
    <>
      <Hero />
      <FlowProof />

      <Section>
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <Eyebrow>{t("problem.eyebrow")}</Eyebrow>
            <Heading>{t("problem.title")}</Heading>
            <p className="mt-6 max-w-md text-pretty text-body text-muted-foreground">{t("problem.body")}</p>
          </div>
          <div className="lg:col-span-7">
            <div className="overflow-hidden rounded-panel border border-border bg-surface-1">
              <p className="border-b border-border px-5 py-3 text-caption text-muted-foreground">
                {t("problem.listLabel")}
              </p>
              <ul className="px-5">
                {(["tracking", "attribution", "webhooks", "recurring", "refunds", "payouts"] as const).map((key) => (
                  <li key={key} className="flex items-center gap-3 border-b border-border-faint py-3 text-ui text-foreground-secondary last:border-0">
                    <Minus className="size-4 shrink-0 text-faint-foreground" aria-hidden="true" />
                    {t(`problem.items.${key}`)}
                  </li>
                ))}
              </ul>
              <div className="flex gap-3 border-t border-border bg-surface-2 px-5 py-5">
                <Check className="mt-0.5 size-4.5 shrink-0 text-primary-text" aria-hidden="true" />
                <div>
                  <p className="text-ui font-medium text-foreground">{t("problem.resolutionTitle")}</p>
                  <p className="mt-1 text-pretty text-caption text-muted-foreground">{t("problem.resolutionBody")}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <HowItWorks />
      <Features />
      <TwoSides />
      <Integrations />
      <Principles />
      <PricingPreview />
      <Closing />
    </>
  )
}

async function Hero() {
  const t = await getTranslations("marketing.home")
  return (
    <section className="overflow-hidden">
      <div className="mx-auto w-full max-w-page px-4 pb-20 pt-16 sm:px-6 sm:pb-28 sm:pt-24 lg:pt-28">
        <div className="max-w-3xl">
          <p className="mb-6 inline-flex items-center gap-2 rounded-badge border border-border px-2 py-1 text-meta text-muted-foreground">
            <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            {t("eyebrow")}
          </p>
          <h1 className="text-balance text-heading-sm text-foreground sm:text-heading lg:text-heading-lg">
            {t("headline")}
          </h1>
          <p className="mt-6 max-w-xl text-pretty text-body text-muted-foreground">
            {t("subhead")}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild variant="primary" size="lg" className="h-11 px-5 sm:h-10">
              <Link href="/signup">
                {t("ctaPrimary")}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg" className="h-11 px-5 sm:h-10">
              <Link href={{ pathname: "/", hash: "como-funciona" }}>{t("ctaSecondary")}</Link>
            </Button>
          </div>
          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-caption text-muted-foreground">
            {(["noCard", "noFee", "stripe"] as const).map((key) => (
              <li key={key} className="flex items-center gap-1.5">
                <Check className="size-3.5 text-faint-foreground" aria-hidden="true" />
                {t(`trust.${key}`)}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-14 sm:mt-20">
          <HeroPreview />
        </div>
      </div>
    </section>
  )
}

/** Micro proof: the four states a referral passes through, in one line. */
async function FlowProof() {
  const t = await getTranslations("marketing.home.flow")
  const { money, currency } = await formatting()
  const steps = [
    { key: "click", sample: "?ref=marina" },
    { key: "signup", sample: "user_8f2c" },
    { key: "customer", sample: money(49700, currency) },
    { key: "commission", sample: `+${money(14910, currency)}` },
  ] as const

  return (
    <section aria-labelledby="flow-title" className="border-t border-border">
      <div className="mx-auto w-full max-w-page px-4 py-14 sm:px-6 sm:py-16">
        <h2 id="flow-title" className="mb-8 text-caption text-muted-foreground">
          {t("label")}
        </h2>
        <ol className="grid gap-px overflow-hidden rounded-panel border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <li key={step.key} className="relative bg-surface-1 p-5">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-meta text-faint-foreground">{String(index + 1).padStart(2, "0")}</span>
                <span
                  className={cn(
                    "truncate rounded-badge border px-1.5 py-0.5 font-mono text-meta tabular-nums",
                    index === 3 ? "border-primary/40 text-primary-text" : "border-border text-foreground-secondary",
                  )}
                >
                  {step.sample}
                </span>
              </div>
              <p className="mt-6 flex items-center gap-2 text-title text-foreground">
                {t(`${step.key}.title`)}
                {index < 3 ? <ArrowRight className="size-4 text-faint-foreground max-lg:hidden" aria-hidden="true" /> : null}
              </p>
              <p className="mt-1 text-pretty text-caption text-muted-foreground">{t(`${step.key}.detail`)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

async function formatting() {
  const f = await getFormatters()
  const currency = DEFAULT_CURRENCY[(await getLocale()) as Locale]
  return { money: f.money, currency }
}

/** Editorial rows: text and the piece of product that step produces, alternating. */
async function HowItWorks() {
  const t = await getTranslations("marketing.home.how")
  const steps = [
    { key: "connect", visual: <StripeVisual /> },
    { key: "commission", visual: <RulesVisual /> },
    { key: "invite", visual: <InviteVisual /> },
    { key: "track", visual: <RevenueVisual /> },
  ] as const

  return (
    <Section id="como-funciona">
      <div className="max-w-2xl">
        <Eyebrow>{t("eyebrow")}</Eyebrow>
        <Heading>{t("title")}</Heading>
        <p className="mt-5 text-pretty text-body text-muted-foreground">{t("subtitle")}</p>
      </div>

      <ol className="mt-16 space-y-16 sm:mt-20 sm:space-y-24">
        {steps.map((step, index) => (
          <li key={step.key} className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16">
            <div className={cn("max-w-md", index % 2 === 1 && "lg:order-2 lg:justify-self-end")}>
              <span className="font-mono text-meta text-faint-foreground">{String(index + 1).padStart(2, "0")}</span>
              <h3 className="mt-3 text-subheading text-foreground">{t(`${step.key}.title`)}</h3>
              <p className="mt-3 text-pretty text-body-sm text-muted-foreground">{t(`${step.key}.body`)}</p>
            </div>
            <div className={cn("w-full max-w-lg", index % 2 === 1 ? "lg:order-1" : "lg:justify-self-end")}>
              {step.visual}
            </div>
          </li>
        ))}
      </ol>
    </Section>
  )
}

/** Three stories under one sticky heading — a different rhythm from the steps above. */
async function Features() {
  const t = await getTranslations("marketing.home.features")
  const stories = [
    { key: "attribution", visual: <AttributionVisual /> },
    { key: "recurring", visual: <LedgerVisual /> },
    { key: "payouts", visual: <PayoutVisual /> },
  ] as const

  return (
    <Section id="produto">
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-4">
          <div className="lg:sticky lg:top-24">
            <Eyebrow>{t("eyebrow")}</Eyebrow>
            <Heading className="sm:text-heading-sm">{t("title")}</Heading>
          </div>
        </div>
        <ol className="lg:col-span-8">
          {stories.map((story, index) => (
            <li
              key={story.key}
              className="grid gap-8 border-t border-border py-10 first:border-0 first:pt-0 sm:py-14 md:grid-cols-[1fr_1.15fr] md:gap-10"
            >
              <div>
                <span className="font-mono text-meta text-faint-foreground">{String(index + 1).padStart(2, "0")}</span>
                <h3 className="mt-3 text-title text-foreground">{t(`${story.key}.title`)}</h3>
                <p className="mt-2 text-pretty text-body-sm text-muted-foreground">{t(`${story.key}.body`)}</p>
              </div>
              <div>{story.visual}</div>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  )
}

async function TwoSides() {
  const t = await getTranslations("marketing.home.sides")
  const sides = [
    { key: "founder", items: ["revenue", "affiliates", "commissions", "payouts"], visual: <FounderVisual /> },
    { key: "affiliate", items: ["clicks", "earnings", "links", "history"], visual: <AffiliateVisual /> },
  ] as const

  return (
    <Section>
      <div className="mx-auto max-w-2xl text-center">
        <Eyebrow>{t("eyebrow")}</Eyebrow>
        <Heading>{t("title")}</Heading>
      </div>
      <div className="mt-14 grid gap-px overflow-hidden rounded-panel border border-border bg-border lg:grid-cols-2">
        {sides.map((side) => (
          <div key={side.key} className="flex flex-col bg-background p-6 sm:p-10">
            <p className="text-caption text-muted-foreground">{t(`${side.key}.label`)}</p>
            <h3 className="mt-3 max-w-sm text-balance text-subheading text-foreground">{t(`${side.key}.title`)}</h3>
            <ul className="mt-6 grid gap-2.5 sm:grid-cols-2">
              {side.items.map((item) => (
                <li key={item} className="flex items-center gap-2 text-caption text-foreground-secondary">
                  <Check className="size-3.5 shrink-0 text-faint-foreground" aria-hidden="true" />
                  {t(`${side.key}.items.${item}`)}
                </li>
              ))}
            </ul>
            <div className="mt-10 flex flex-1 items-end">
              <div className="w-full">{side.visual}</div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

async function Integrations() {
  const t = await getTranslations("marketing.home.integrations")
  const items = [
    { key: "stripe", icon: CreditCard, available: true },
    { key: "tracker", icon: Code2, available: false },
    { key: "api", icon: Lock, available: false },
  ] as const

  return (
    <Section id="integracoes">
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-4">
          <Eyebrow>{t("eyebrow")}</Eyebrow>
          <Heading className="sm:text-heading-sm">{t("title")}</Heading>
        </div>
        <div className="lg:col-span-8">
          <ul className="grid gap-px overflow-hidden rounded-panel border border-border bg-border sm:grid-cols-3">
            {items.map((item) => (
              <li key={item.key} className="bg-surface-1 p-5">
                <div className="flex items-center justify-between">
                  <span className="flex size-9 items-center justify-center rounded-control border border-border bg-surface-2 text-foreground-secondary">
                    <item.icon className="size-4" aria-hidden="true" />
                  </span>
                  {item.available ? (
                    <span className="inline-flex h-5 items-center gap-1.5 rounded-badge border border-border px-1.5 text-meta font-medium text-foreground-secondary">
                      <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
                      {t("available")}
                    </span>
                  ) : null}
                </div>
                <p className="mt-5 text-ui font-medium text-foreground">{t(`${item.key}.title`)}</p>
                <p className="mt-1 text-pretty text-caption text-muted-foreground">{t(`${item.key}.body`)}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-caption text-faint-foreground">{t("more")}</p>
        </div>
      </div>
    </Section>
  )
}

/** Product-based trust. Nothing here is a claim the code does not keep. */
async function Principles() {
  const t = await getTranslations("marketing.home.principles")
  const items = [
    { key: "noFee", icon: CircleDollarSign },
    { key: "money", icon: ShieldCheck },
    { key: "privacy", icon: Lock },
    { key: "ledger", icon: FileClock },
  ] as const

  return (
    <Section>
      <div className="max-w-2xl">
        <Eyebrow>{t("eyebrow")}</Eyebrow>
        <Heading>{t("title")}</Heading>
      </div>
      <ul className="mt-14 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <li key={item.key} className="border-t border-border pt-5">
            <item.icon className="size-4.5 text-muted-foreground" aria-hidden="true" />
            <p className="mt-4 text-ui font-medium text-foreground">{t(`${item.key}.title`)}</p>
            <p className="mt-1.5 text-pretty text-caption text-muted-foreground">{t(`${item.key}.body`)}</p>
          </li>
        ))}
      </ul>
    </Section>
  )
}

async function PricingPreview() {
  const t = await getTranslations("marketing.home.pricing")
  const tp = await getTranslations("pricing")
  const locale = (await getLocale()) as Locale
  const { money, currency } = await formatting()

  return (
    <Section>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-xl">
          <Eyebrow>{t("eyebrow")}</Eyebrow>
          <Heading className="sm:text-heading-sm">{t("title")}</Heading>
        </div>
        <Button asChild variant="secondary" className="self-start sm:self-auto">
          <Link href="/pricing">
            {t("cta")}
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
      <ul className="mt-12 grid gap-px overflow-hidden rounded-panel border border-border bg-border md:grid-cols-3">
        {PLANS.map((plan) => {
          const price = PRICE_MINOR[locale][plan.key]
          return (
            <li key={plan.key} className="bg-surface-1 p-6">
              <p className="flex items-center gap-2 text-ui font-medium text-foreground">
                {tp(`plans.${plan.key}.name`)}
                {plan.featured ? (
                  <span className="rounded-badge border border-primary/40 px-1.5 text-meta text-primary-text">
                    {tp("mostPopular")}
                  </span>
                ) : null}
              </p>
              <p className="mt-4 flex items-baseline gap-1.5">
                <span className="text-heading-sm tabular-nums text-foreground">
                  {price === 0 ? t("free") : money(price, currency)}
                </span>
                {price === 0 ? null : (
                  <span className="text-caption text-muted-foreground">{tp(`plans.${plan.key}.cadence`)}</span>
                )}
              </p>
              <p className="mt-3 text-pretty text-caption text-muted-foreground">{tp(`plans.${plan.key}.description`)}</p>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

async function Closing() {
  const t = await getTranslations("marketing.home")
  return (
    <section className="border-t border-border">
      <div className="mx-auto w-full max-w-page px-4 py-20 sm:px-6 sm:py-28">
        <div className="rounded-panel border border-border bg-surface-1 px-6 py-14 text-center sm:px-12 sm:py-20">
          <h2 className="mx-auto max-w-2xl text-balance text-heading-sm text-foreground sm:text-heading">
            {t("closing.title")}
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-pretty text-body text-muted-foreground">{t("closing.body")}</p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild variant="primary" size="lg" className="h-11 px-5 sm:h-10">
              <Link href="/signup">
                {t("ctaPrimary")}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="lg" className="h-11 px-5 sm:h-10">
              <Link href="/pricing">{t("closing.secondary")}</Link>
            </Button>
          </div>
          <ul className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-caption text-muted-foreground">
            {(["noCard", "noFee"] as const).map((key) => (
              <li key={key} className="flex items-center gap-1.5">
                <Check className="size-3.5 text-faint-foreground" aria-hidden="true" />
                {t(`trust.${key}`)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
